package com.workflowai.meeting;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.rag.RagIngestService;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class MeetingAnalysisPersistence {
    private static final Logger log = LoggerFactory.getLogger(MeetingAnalysisPersistence.class);
    public static final String DEFAULT_ANALYSIS_ERROR_MESSAGE = "회의록 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    public static final String REUPLOAD_REQUIRED_ERROR_MESSAGE = "원본 음성 파일은 재분석을 위해 다시 업로드해야 합니다.";
    public static final String REUPLOAD_READ_ERROR_MESSAGE = "원본 회의록 내용을 읽을 수 없어 재분석을 위해 다시 업로드해야 합니다.";

    private final MeetingRepository meetingRepository;
    private final MeetingAnalysisRepository meetingAnalysisRepository;
    private final MeetingActionItemRepository meetingActionItemRepository;
    private final MeetingAttendeeRepository meetingAttendeeRepository;
    private final UserRepository userRepository;
    private final DemoDataService demoDataService;
    private final RagIngestService ragIngestService;
    private final ProjectMemberRepository projectMemberRepository;
    private final NotificationService notificationService;
    private final TransactionTemplate requiresNewNotificationTransaction;

    public MeetingAnalysisPersistence(
        MeetingRepository meetingRepository,
        MeetingAnalysisRepository meetingAnalysisRepository,
        MeetingActionItemRepository meetingActionItemRepository,
        MeetingAttendeeRepository meetingAttendeeRepository,
        UserRepository userRepository,
        DemoDataService demoDataService,
        RagIngestService ragIngestService,
        ProjectMemberRepository projectMemberRepository,
        NotificationService notificationService,
        PlatformTransactionManager transactionManager
    ) {
        this.meetingRepository = meetingRepository;
        this.meetingAnalysisRepository = meetingAnalysisRepository;
        this.meetingActionItemRepository = meetingActionItemRepository;
        this.meetingAttendeeRepository = meetingAttendeeRepository;
        this.userRepository = userRepository;
        this.demoDataService = demoDataService;
        this.ragIngestService = ragIngestService;
        this.projectMemberRepository = projectMemberRepository;
        this.notificationService = notificationService;
        this.requiresNewNotificationTransaction = new TransactionTemplate(transactionManager);
        this.requiresNewNotificationTransaction.setPropagationBehavior(TransactionTemplate.PROPAGATION_REQUIRES_NEW);
    }

    @Transactional
    public void saveAnalysisSuccess(Long meetingId, MeetingAnalysisResult result, String analysisSource) {
        persistAnalysisSuccess(meetingId, result, analysisSource, null, false, null);
    }

    @Transactional
    public boolean claimJob(Long meetingId, UUID jobId) {
        Meeting meeting = meetingRepository.findByIdForUpdate(meetingId).orElse(null);
        if (meeting == null || isTerminal(meeting.getAnalysisStatus())) {
            return false;
        }
        if (meeting.getAnalysisJobId() == null) {
            meeting.setAnalysisJobId(jobId);
            meetingRepository.save(meeting);
            return true;
        }
        return Objects.equals(meeting.getAnalysisJobId(), jobId);
    }

    @Transactional
    public void saveAnalysisSuccessForJob(
        Long meetingId,
        MeetingAnalysisResult result,
        String analysisSource,
        UUID jobId,
        Long requestedBy
    ) {
        persistAnalysisSuccess(meetingId, result, analysisSource, jobId, true, requestedBy);
    }

    private void persistAnalysisSuccess(
        Long meetingId,
        MeetingAnalysisResult result,
        String analysisSource,
        UUID jobId,
        boolean fenced,
        Long requestedBy
    ) {
        Meeting meeting = meetingRepository.findByIdForUpdate(meetingId).orElseThrow(
            () -> new IllegalStateException("Meeting not found: " + meetingId));
        if (fenced && !Objects.equals(meeting.getAnalysisJobId(), jobId)) {
            log.info("이전 세대 회의 분석 성공 저장 생략. meetingId={}", meetingId);
            return;
        }
        if ("completed".equalsIgnoreCase(meeting.getAnalysisStatus())
            || (!fenced && "failed".equalsIgnoreCase(meeting.getAnalysisStatus()))) {
            log.info("중복 회의 분석 저장 생략. meetingId={}, status={}", meetingId, meeting.getAnalysisStatus());
            return;
        }

        MeetingAnalysis analysis = meetingAnalysisRepository.save(new MeetingAnalysis(
            meetingId, result.summary(), result.decisions(), result.risks(), result.keywords(), analysisSource
        ));
        String meetingRagContent = buildMeetingIngestContent(result);
        ragIngestService.recordIngestIntent(
            meeting.getProjectId(),
            "meeting",
            analysis.getMeetingId(),
            meetingRagContent,
            null
        );
        runAfterCommit(() ->
            ragIngestService.ingestBestEffort(
                meeting.getProjectId(),
                "meeting",
                analysis.getMeetingId(),
                meetingRagContent
            )
        );

        // 버전(수정본)은 참석자 행을 별도로 갖지 않으므로, 원본(root) 회의록의 참석자 집합을 기준으로 담당자를 판별한다.
        Long attendeeSourceMeetingId = meeting.getOriginalMeetingId() != null ? meeting.getOriginalMeetingId() : meetingId;
        Set<Long> attendeeUserIds = meetingAttendeeRepository.findByMeetingId(attendeeSourceMeetingId).stream()
            .map(MeetingAttendee::getUserId)
            .collect(Collectors.toSet());

        for (MeetingTodo todo : result.todos()) {
            MeetingActionItem actionItem = meetingActionItemRepository.save(new MeetingActionItem(
                meetingId,
                todo.title(),
                todo.description(),
                todo.category(),
                resolveAssigneeByName(todo.assignee_candidate()),
                resolveFinalAssignee(todo, meeting.getProjectId(), attendeeUserIds),
                parseDateOrNull(todo.due_date()),
                todo.priority(),
                todo.evidence_text()
            ));
            if (actionItem != null) {
                String actionItemRagContent = buildActionItemIngestContent(actionItem);
                ragIngestService.recordIngestIntent(
                    meeting.getProjectId(),
                    "action_item",
                    actionItem.getId(),
                    actionItemRagContent,
                    actionItem.getFinalAssigneeId()
                );
                runAfterCommit(() ->
                    ragIngestService.ingestBestEffort(
                        meeting.getProjectId(), "action_item", actionItem.getId(),
                        actionItemRagContent, actionItem.getFinalAssigneeId()
                    )
                );
            }
        }

        meeting.setAnalysisStatus("completed");
        meetingRepository.save(meeting);

        notifyAnalysisCompleted(meeting, meetingId, requestedBy);
    }

    /**
     * 분석을 실제로 트리거한 사용자(requestedBy) 본인에게는 알리지 않는다 — 본인은 분석 화면에서
     * 결과를 바로 확인하고 있기 때문이다. 그 사람이 팀장이 아닐 때만 팀장에게 "역할분배를
     * 진행해달라"고 알린다. requestedBy가 없는 레거시 경로는 원본 업로더를 행위자로 간주한다.
     */
    private void notifyAnalysisCompleted(Meeting meeting, Long meetingId, Long requestedBy) {
        Long actorId = requestedBy != null ? requestedBy : meeting.getUploadedBy();
        if (actorId == null) {
            return;
        }
        String actorName = userRepository.findById(actorId).map(User::getName).orElse("누군가");
        projectMemberRepository.findByProjectIdAndRole(meeting.getProjectId(), com.workflowai.project.ProjectRole.LEADER)
            .map(com.workflowai.project.ProjectMember::getUserId)
            .filter(leaderId -> !leaderId.equals(actorId))
            .ifPresent(leaderId -> notifyBestEffort(
                leaderId, meeting.getProjectId(), "MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER",
                "회의록 분석이 완료되었습니다.",
                actorName + "님이 '" + meeting.getTitle() + "' 회의록 분석을 완료했습니다. 역할분배 및 업무등록을 진행해주세요.",
                meetingId
            ));
    }

    @Transactional
    public void saveAnalysisFailure(Long meetingId, String errorMessage) {
        persistAnalysisFailure(meetingId, null, false);
    }

    @Transactional
    public void saveAnalysisFailureForJob(Long meetingId, String errorMessage, UUID jobId) {
        persistAnalysisFailure(meetingId, jobId, true);
    }

    /** afterCommit 호출에서도 이미 커밋된 원 트랜잭션에 합류하지 않도록 새 트랜잭션을 강제한다. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveAnalysisFailureInNewTransaction(Long meetingId, String errorMessage) {
        persistAnalysisFailure(meetingId, null, false);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveAnalysisFailureInNewTransaction(Long meetingId, String errorMessage, UUID jobId) {
        persistAnalysisFailure(meetingId, jobId, true);
    }

    private void persistAnalysisFailure(Long meetingId, UUID jobId, boolean fenced) {
        meetingRepository.findByIdForUpdate(meetingId).ifPresent(meeting -> {
            if (fenced && !Objects.equals(meeting.getAnalysisJobId(), jobId)) {
                log.info("이전 세대 회의 분석 실패 저장 생략. meetingId={}", meetingId);
                return;
            }
            if (isTerminal(meeting.getAnalysisStatus())) {
                return;
            }
            meeting.setAnalysisStatus("failed");
            meetingRepository.save(meeting);
            if (meeting.getUploadedBy() != null) {
                notifyBestEffort(
                    meeting.getUploadedBy(), meeting.getProjectId(), "MEETING_ANALYSIS_FAILED", "회의 분석에 실패했습니다.",
                    "'" + meeting.getTitle() + "' 회의록 분석에 실패했습니다. 다시 시도해주세요.", meetingId
                );
            }
        });
    }

    private boolean isTerminal(String status) {
        return "completed".equalsIgnoreCase(status) || "failed".equalsIgnoreCase(status);
    }

    public static String toSafeErrorMessage(String errorMessage) {
        if (REUPLOAD_REQUIRED_ERROR_MESSAGE.equals(errorMessage)) {
            return REUPLOAD_REQUIRED_ERROR_MESSAGE;
        }
        if (REUPLOAD_READ_ERROR_MESSAGE.equals(errorMessage)) {
            return REUPLOAD_READ_ERROR_MESSAGE;
        }
        return DEFAULT_ANALYSIS_ERROR_MESSAGE;
    }

    private String buildMeetingIngestContent(MeetingAnalysisResult result) {
        StringBuilder content = new StringBuilder(defaultString(result.summary(), ""));
        if (result.decisions() != null && !result.decisions().isEmpty()) {
            content.append("\n결정사항: ").append(String.join(", ", result.decisions()));
        }
        if (result.risks() != null && !result.risks().isEmpty()) {
            content.append("\n위험요소: ").append(String.join(", ", result.risks()));
        }
        return content.toString();
    }

    private String buildActionItemIngestContent(MeetingActionItem item) {
        StringBuilder content = new StringBuilder(defaultString(item.getTitle(), ""));
        if (item.getDescription() != null && !item.getDescription().isBlank()) {
            content.append(" - ").append(item.getDescription());
        }
        if (item.getBasis() != null && !item.getBasis().isBlank()) {
            content.append("\n근거: ").append(item.getBasis());
        }
        return content.toString();
    }

    /**
     * 알림 발송은 분석 결과 저장의 부가 기능이라 실패해도 안 되고, 트랜잭션이 실제로
     * 커밋되기 전에는(즉 분석 결과가 확정되기 전에는) 나가면 안 된다.
     * 트랜잭션 동기화가 걸려 있으면(정상적인 @Transactional 호출 경로) afterCommit
     * 콜백으로 미뤄서 커밋 이후에만 보내고, 동기화가 없는 컨텍스트(단위 테스트 등
     * 트랜잭션 프록시 밖에서 직접 호출되는 경우)에서는 즉시 best-effort로 보낸다.
     */
    private void notifyBestEffort(Long userId, Long projectId, String type, String title,
                                  String content, Long meetingId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    sendNotificationSafely(userId, projectId, type, title, content, meetingId);
                }
            });
            return;
        }
        sendNotificationSafely(userId, projectId, type, title, content, meetingId);
    }

    private void runAfterCommit(Runnable operation) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    operation.run();
                }
            });
            return;
        }
        operation.run();
    }

    /**
     * afterCommit() 콜백은 원래 트랜잭션의 자원이 아직 스레드에서 완전히 언바인딩되기
     * 전에 실행된다 (Spring은 cleanupAfterCompletion보다 afterCommit을 먼저 호출한다).
     * 그 상태에서 NotificationService.notify()가 기본 전파(REQUIRED)로 저장을 하면
     * 이미 커밋 처리 중인 트랜잭션에 잘못 합류해 실제로 커밋되지 않을 위험이 있다.
     * REQUIRES_NEW로 감싸 항상 독립된 새 물리 트랜잭션에서 커밋되도록 강제한다.
     */
    private void sendNotificationSafely(Long userId, Long projectId, String type, String title,
                                        String content, Long meetingId) {
        try {
            requiresNewNotificationTransaction.executeWithoutResult(status ->
                notificationService.notifyAfterCommit(userId, projectId, type, title, content, "meeting", meetingId));
        } catch (Exception e) {
            log.warn("회의 분석 알림 발송 실패. meetingId={}, projectId={}, userId={}, type={}",
                meetingId, projectId, userId, type, e);
        }
    }

    private Long resolveAssigneeByName(String name) {
        if (name == null || name.isBlank()) return null;
        return userRepository.findFirstByName(name).map(User::getId).orElse(null);
    }

    private Long resolveAssignee(String assigneeIdParam) {
        if (assigneeIdParam == null || assigneeIdParam.isBlank()) return null;
        Long resolved = demoDataService.resolveUserId(assigneeIdParam);
        if (resolved != null) return resolved;
        try {
            return Long.parseLong(assigneeIdParam);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 회의록 본문에 적힌 담당자(assignee_candidate)를 1차 기준으로 최종 담당자를 결정한다.
     * 프로젝트 멤버이면서 동시에 이번 회의의 참석자(meeting_attendees)로 저장된 사용자만 자동 배정하고,
     * 그렇지 않으면(프로젝트 멤버라도 참석자가 아니면) 미배정(null)으로 남긴다.
     */
    private Long resolveFinalAssignee(MeetingTodo todo, Long projectId, Set<Long> attendeeUserIds) {
        Long explicitAssigneeId = resolveAssignee(todo.assignee_id());
        if (explicitAssigneeId != null) {
            return isAssignableAttendee(projectId, explicitAssigneeId, attendeeUserIds) ? explicitAssigneeId : null;
        }
        Long candidateUserId = resolveAssigneeByName(todo.assignee_candidate());
        if (candidateUserId != null && isAssignableAttendee(projectId, candidateUserId, attendeeUserIds)) {
            return candidateUserId;
        }
        return null;
    }

    private boolean isAssignableAttendee(Long projectId, Long userId, Set<Long> attendeeUserIds) {
        return attendeeUserIds.contains(userId) && projectMemberRepository.existsByProjectIdAndUserId(projectId, userId);
    }

    private LocalDate parseDateOrNull(String date) {
        if (date == null || date.isBlank()) return null;
        try {
            return LocalDate.parse(date);
        } catch (Exception e) {
            return null;
        }
    }

    private String defaultString(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
