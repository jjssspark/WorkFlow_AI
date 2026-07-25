package com.workflowai.meeting;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.Notification;
import com.workflowai.notification.NotificationRepository;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectRole;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectSchedulePolicy;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.CurrentUser;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MeetingAnalysisService {
    private static final Logger log = LoggerFactory.getLogger(MeetingAnalysisService.class);
    private static final Set<String> AUDIO_FILE_EXTENSIONS = Set.of(".mp3", ".wav", ".m4a", ".ogg");
    // 전역 멀티파트 한도(100MB)보다 낮게 둔다 - STT 단계에서 파일 전체를 메모리에 올리므로(Files.readAllBytes),
    // 큐 워커의 OOM 위험을 줄이기 위해 오디오는 더 보수적인 한도를 별도로 둔다.
    private static final long MAX_AUDIO_FILE_SIZE_BYTES = 30L * 1024 * 1024;

    private final MeetingAnalysisJobPublisher meetingAnalysisJobPublisher;
    private final DemoDataService demoDataService;
    private final MeetingRepository meetingRepository;
    private final MeetingAttendeeRepository meetingAttendeeRepository;
    private final MeetingAnalysisRepository meetingAnalysisRepository;
    private final MeetingActionItemRepository meetingActionItemRepository;
    private final TaskRepository taskRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationService notificationService;
    private final UserRepository userRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final RagIngestService ragIngestService;
    private final MeetingAnalysisPersistence meetingAnalysisPersistence;
    private final String uploadsDir;

    public MeetingAnalysisService(
        MeetingAnalysisJobPublisher meetingAnalysisJobPublisher,
        DemoDataService demoDataService,
        MeetingRepository meetingRepository,
        MeetingAttendeeRepository meetingAttendeeRepository,
        MeetingAnalysisRepository meetingAnalysisRepository,
        MeetingActionItemRepository meetingActionItemRepository,
        TaskRepository taskRepository,
        NotificationRepository notificationRepository,
        NotificationService notificationService,
        UserRepository userRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        RagIngestService ragIngestService,
        MeetingAnalysisPersistence meetingAnalysisPersistence,
        @Value("${workflow.uploads.dir}") String uploadsDir
    ) {
        this.meetingAnalysisJobPublisher = meetingAnalysisJobPublisher;
        this.demoDataService = demoDataService;
        this.meetingRepository = meetingRepository;
        this.meetingAttendeeRepository = meetingAttendeeRepository;
        this.meetingAnalysisRepository = meetingAnalysisRepository;
        this.meetingActionItemRepository = meetingActionItemRepository;
        this.taskRepository = taskRepository;
        this.notificationRepository = notificationRepository;
        this.notificationService = notificationService;
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.ragIngestService = ragIngestService;
        this.meetingAnalysisPersistence = meetingAnalysisPersistence;
        this.uploadsDir = uploadsDir;
    }

    @Transactional
    public MeetingAnalysisResponse analyze(
        String projectId,
        MultipartFile file,
        String title,
        String meetingDate,
        String meetingKind,
        String sourceType,
        List<String> participants,
        List<Long> attendeeIds
    ) {
        Long projectDbId = requireProjectMember(projectId);
        List<Long> safeAttendeeIds = attendeeIds == null
            ? List.of()
            : attendeeIds.stream().filter(id -> id != null).distinct().toList();
        if (!safeAttendeeIds.isEmpty()) {
            validateAttendeeIds(projectDbId, safeAttendeeIds);
        }

        String fileName = file == null ? null : file.getOriginalFilename();
        // 음성 파일은 STT에 수 초~수십 초가 걸려 업로드 요청 안에서 동기 처리하면 타임아웃 위험이 크다.
        // 여기서는 텍스트를 비워두고, 실제 추출은 비동기 분석 큐(MeetingAnalysisRunner)에서 수행한다.
        boolean isAudioUpload = fileName != null && isAudioFile(fileName.toLowerCase());
        if (isAudioUpload) {
            validateAudioFileSize(file);
        }
        String text = isAudioUpload ? "" : extractText(file);
        String resolvedTitle = defaultString(title, "회의록 AI 분석 회의");
        String resolvedDate = defaultString(meetingDate, LocalDate.now().toString());
        // sourceType은 프론트가 넘겨주지 않거나 "document" 기본값으로 올 수 있는데, 파일 확장자로 오디오임이
        // 이미 확인됐다면 여기서 강제로 "audio"로 정규화해야 한다. 그래야 비동기 큐(MeetingAnalysisRunner)가
        // source_type만 보고 STT 필요 여부를 판단할 때 누락 없이 정확히 오디오로 인식한다.
        String resolvedSourceType = isAudioUpload ? "audio" : defaultString(sourceType, "document");

        UUID jobId = UUID.randomUUID();
        Meeting newMeeting = new Meeting(
            projectDbId,
            resolvedTitle,
            resolvedSourceType,
            null,
            "processing",
            LocalDate.parse(resolvedDate),
            meetingKind,
            fileName,
            CurrentUser.id(),
            file == null ? null : file.getSize()
        );
        newMeeting.setAnalysisJobId(jobId);
        Meeting meeting = meetingRepository.save(newMeeting);

        meeting.setFilePath(storeUploadedFile(meeting.getId(), file));
        meeting.setTranscript(text);
        meetingRepository.save(meeting);

        List<String> resolvedParticipantNames;
        if (!safeAttendeeIds.isEmpty()) {
            saveAttendeesByIds(meeting.getId(), safeAttendeeIds);
            resolvedParticipantNames = userRepository.findAllById(safeAttendeeIds).stream().map(User::getName).toList();
        } else {
            List<String> names = safeParticipants(participants);
            saveAttendees(meeting.getId(), projectDbId, names);
            resolvedParticipantNames = names;
        }

        AiAnalyzeRequest request = new AiAnalyzeRequest(
            projectId,
            resolvedTitle,
            resolvedDate,
            defaultString(meetingKind, "정기회의"),
            resolvedSourceType,
            fileName,
            text,
            resolvedParticipantNames
        );
        runAnalysisAfterCommit(meeting.getId(), request, jobId);

        String meetingId = String.valueOf(meeting.getId());
        return new MeetingAnalysisResponse(
            meetingId, projectId, "PROCESSING", resolvedSourceType, fileName, null, null, null,
            buildAttendeeSummaries(meeting.getId(), projectDbId), meeting.getTranscript()
        );
    }

    public MeetingAnalysisResponse find(String projectId, String meetingId) {
        Meeting meeting = requireProjectMeeting(projectId, meetingId);
        if (meeting == null) return null;
        Long id = parseLongOrNull(meetingId);

        if (!"completed".equals(meeting.getAnalysisStatus())) {
            String status = "failed".equals(meeting.getAnalysisStatus()) ? "FAILED" : "PROCESSING";
            String errorMessage = "FAILED".equals(status)
                ? MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE
                : null;
            return new MeetingAnalysisResponse(
                meetingId,
                toResponseProjectId(meeting.getProjectId()),
                status,
                meeting.getFileType(),
                meeting.getOriginalFileName(),
                null,
                null,
                errorMessage,
                buildAttendeeSummaries(id, meeting.getProjectId()),
                meeting.getTranscript()
            );
        }

        MeetingAnalysis analysis = meetingAnalysisRepository.findById(id).orElse(null);
        if (analysis == null) return null;

        List<MeetingTodo> todos = meetingActionItemRepository.findByMeetingId(id).stream()
            .map(this::toMeetingTodo)
            .toList();
        MeetingAnalysisResult result = new MeetingAnalysisResult(
            analysis.getSummary(),
            analysis.getDecisions(),
            todos,
            analysis.getRisks(),
            analysis.getKeywords(),
            new MeetingMeta(
                meeting.getTitle(),
                meeting.getMeetingDate() == null ? null : meeting.getMeetingDate().toString(),
                List.of()
            )
        );
        return new MeetingAnalysisResponse(
            meetingId,
            toResponseProjectId(meeting.getProjectId()),
            "COMPLETED",
            meeting.getFileType(),
            meeting.getOriginalFileName(),
            analysis.getAnalysisEngine(),
            result,
            null,
            buildAttendeeSummaries(id, meeting.getProjectId()),
            meeting.getTranscript()
        );
    }

    public MeetingStatusResponse findStatus(String projectId, String meetingId) {
        Meeting meeting = requireProjectMeeting(projectId, meetingId);
        if (meeting == null) return null;
        String status = switch (meeting.getAnalysisStatus()) {
            case "completed" -> "COMPLETED";
            case "failed" -> "FAILED";
            default -> "PROCESSING";
        };
        String errorMessage = "FAILED".equals(status)
            ? MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE
            : null;
        return new MeetingStatusResponse(meetingId, status, errorMessage);
    }

    @Transactional
    public MeetingAnalysisResponse retry(String projectId, String meetingId) {
        Meeting meeting = requireProjectMeeting(projectId, meetingId);
        if (meeting == null) return null;
        Long id = parseLongOrNull(meetingId);
        if (!"failed".equals(meeting.getAnalysisStatus())) {
            throw new IllegalStateException("MEETING_NOT_FAILED");
        }

        String text = extractTextFromStoredFile(meeting);
        if (text == null) {
            String errorMessage = MeetingAnalysisPersistence.REUPLOAD_REQUIRED_ERROR_MESSAGE;
            meetingAnalysisPersistence.saveAnalysisFailure(id, errorMessage);
            return new MeetingAnalysisResponse(
                meetingId,
                toResponseProjectId(meeting.getProjectId()),
                "FAILED",
                meeting.getFileType(),
                meeting.getOriginalFileName(),
                null,
                null,
                errorMessage,
                buildAttendeeSummaries(id, meeting.getProjectId()),
                meeting.getTranscript()
            );
        }
        if (text.isBlank()) {
            String errorMessage = MeetingAnalysisPersistence.REUPLOAD_READ_ERROR_MESSAGE;
            meetingAnalysisPersistence.saveAnalysisFailure(id, errorMessage);
            return new MeetingAnalysisResponse(
                meetingId,
                toResponseProjectId(meeting.getProjectId()),
                "FAILED",
                meeting.getFileType(),
                meeting.getOriginalFileName(),
                null,
                null,
                errorMessage,
                buildAttendeeSummaries(id, meeting.getProjectId()),
                meeting.getTranscript()
            );
        }
        List<String> participantNames = meetingAttendeeRepository.findByMeetingId(id).stream()
            .map(attendee -> userRepository.findById(attendee.getUserId()).map(User::getName).orElse(null))
            .filter(name -> name != null)
            .toList();

        AiAnalyzeRequest request = new AiAnalyzeRequest(
            toResponseProjectId(meeting.getProjectId()),
            meeting.getTitle(),
            meeting.getMeetingDate() == null ? LocalDate.now().toString() : meeting.getMeetingDate().toString(),
            defaultString(meeting.getMeetingType(), "정기회의"),
            defaultString(meeting.getFileType(), "document"),
            meeting.getOriginalFileName(),
            text,
            participantNames
        );

        UUID jobId = UUID.randomUUID();
        meeting.setAnalysisStatus("processing");
        meeting.setTranscript(text);
        meeting.setAnalysisJobId(jobId);
        meetingRepository.save(meeting);

        runAnalysisAfterCommit(id, request, jobId);

        return new MeetingAnalysisResponse(
            meetingId,
            toResponseProjectId(meeting.getProjectId()),
            "PROCESSING",
            meeting.getFileType(),
            meeting.getOriginalFileName(),
            null,
            null,
            null,
            buildAttendeeSummaries(id, meeting.getProjectId()),
            meeting.getTranscript()
        );
    }

    public List<MeetingSummary> findByProject(String projectId) {
        Long projectDbId = requireProjectMember(projectId);
        List<Meeting> meetings = meetingRepository.findByProjectIdOrderByCreatedAtDesc(projectDbId);

        List<Long> meetingIds = meetings.stream().map(Meeting::getId).toList();
        Set<Long> meetingIdsWithRegisteredTasks = meetingIds.isEmpty()
            ? Set.of()
            : meetingActionItemRepository.findByMeetingIdIn(meetingIds).stream()
                .filter(item -> item.getCreatedTaskId() != null)
                .map(MeetingActionItem::getMeetingId)
                .collect(Collectors.toSet());

        return meetings.stream()
            .map(m -> new MeetingSummary(
                String.valueOf(m.getId()),
                m.getTitle(),
                m.getMeetingDate() == null ? null : m.getMeetingDate().toString(),
                m.getMeetingType(),
                m.getAnalysisStatus(),
                m.getSavedAt() == null ? null : m.getSavedAt().toString(),
                m.getOriginalMeetingId() == null ? null : String.valueOf(m.getOriginalMeetingId()),
                meetingIdsWithRegisteredTasks.contains(m.getId())
            ))
            .toList();
    }

    /** 프로젝트 멤버별 회의 참석 횟수/참석률 요약 — 기여도 화면의 회의 참여 지표로 쓰인다. */
    public List<MeetingAttendanceSummary> attendanceSummary(String projectId) {
        Long projectDbId = requireProjectMember(projectId);
        List<Meeting> meetings = meetingRepository.findByProjectIdOrderByCreatedAtDesc(projectDbId);
        int totalMeetings = meetings.size();

        List<Long> meetingIds = meetings.stream().map(Meeting::getId).toList();
        Map<Long, Long> attendedCountByUserId = meetingIds.isEmpty()
            ? Map.of()
            : meetingAttendeeRepository.findByMeetingIdIn(meetingIds).stream()
                .collect(Collectors.groupingBy(MeetingAttendee::getUserId, Collectors.counting()));

        List<ProjectMember> members = projectMemberRepository.findAllByProjectId(projectDbId);
        Map<Long, User> usersById = userRepository
            .findAllById(members.stream().map(ProjectMember::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, user -> user));

        return members.stream()
            .map(member -> {
                User user = usersById.get(member.getUserId());
                int attended = attendedCountByUserId.getOrDefault(member.getUserId(), 0L).intValue();
                int rate = totalMeetings == 0 ? 0 : Math.round(attended * 100f / totalMeetings);
                return new MeetingAttendanceSummary(
                    member.getUserId(),
                    user != null ? user.getName() : null,
                    attended,
                    totalMeetings,
                    rate
                );
            })
            .toList();
    }

    /** 특정 팀원의 회의별 참석/결석 여부와 날짜 — 기여도 화면의 회의 참여 드릴다운에 쓰인다. */
    public List<MeetingAttendanceDetail> attendanceDetail(String projectId, Long userId) {
        Long projectDbId = requireProjectMember(projectId);
        List<Meeting> meetings = meetingRepository.findByProjectIdOrderByCreatedAtDesc(projectDbId);
        if (meetings.isEmpty()) return List.of();

        List<Long> meetingIds = meetings.stream().map(Meeting::getId).toList();
        Set<Long> attendedMeetingIds = meetingAttendeeRepository.findByMeetingIdIn(meetingIds).stream()
            .filter(attendee -> attendee.getUserId().equals(userId))
            .filter(attendee -> attendee.getMeetingId() != null)
            .map(MeetingAttendee::getMeetingId)
            .collect(Collectors.toSet());

        return meetings.stream()
            .sorted(Comparator.comparing(Meeting::getMeetingDate, Comparator.nullsLast(Comparator.naturalOrder())))
            .map(meeting -> new MeetingAttendanceDetail(
                String.valueOf(meeting.getId()),
                meeting.getTitle(),
                meeting.getMeetingDate() == null ? null : meeting.getMeetingDate().toString(),
                meeting.getId() != null && attendedMeetingIds.contains(meeting.getId())
            ))
            .toList();
    }

    @Transactional
    public MeetingDeleteResponse delete(String projectId, String meetingId, boolean deleteLinkedTasks) {
        Long projectDbId = requireProjectMember(projectId);
        Long meetingDbId = parseLongOrNull(meetingId);
        if (meetingDbId == null) return null;
        Meeting meeting = meetingRepository.findByIdAndProjectIdForUpdate(meetingDbId, projectDbId).orElse(null);
        if (meeting == null) return null;
        // 존재하지 않는 회의록에 대해서도 비팀장에게 403을 먼저 주면 기존 404 응답 계약이 깨지므로,
        // 회의록 존재를 먼저 확인한 뒤에 팀장 권한을 검사한다.
        requireLeader(projectDbId);

        String filePath = meeting.getFilePath();
        List<Task> linkedTasks = deleteLinkedTasks
            ? taskRepository.findBySourceMeetingId(meetingDbId)
            : List.of();
        List<MeetingActionItem> linkedActionItems = deleteLinkedTasks
            ? meetingActionItemRepository.findByMeetingId(meetingDbId)
            : List.of();
        ragIngestService.recordDeleteSourceIntent(meeting.getProjectId(), "meeting", meetingDbId);
        linkedTasks.forEach(task ->
            ragIngestService.recordDeleteSourceIntent(task.getProjectId(), "task", task.getId())
        );
        linkedActionItems.forEach(item ->
            ragIngestService.recordDeleteSourceIntent(meeting.getProjectId(), "action_item", item.getId())
        );
        meetingAttendeeRepository.deleteByMeetingId(meetingDbId);
        if (meetingAnalysisRepository.existsById(meetingDbId)) {
            meetingAnalysisRepository.deleteById(meetingDbId);
        }
        if (deleteLinkedTasks) {
            meetingActionItemRepository.deleteByMeetingId(meetingDbId);
            taskRepository.deleteBySourceMeetingId(meetingDbId);
        } else {
            meetingActionItemRepository.clearMeetingId(meetingDbId);
            taskRepository.clearSourceMeetingId(meetingDbId);
        }
        // 삭제는 팀장 전용이라 actorId가 항상 팀장이다 — 반대편(counterpart)은 팀장 자신이 아니라
        // 원본 업로더로 잡아야, 팀장이 남이 올린 회의록을 지웠을 때 그 업로더에게도 알림이 간다.
        Long actorId = CurrentUser.id();
        Long uploaderId = meeting.getUploadedBy();
        String title = meeting.getTitle();
        String actorName = defaultString(resolveNameById(actorId), "누군가");
        String scopeSuffix = deleteLinkedTasks ? " (등록된 업무도 함께 삭제됨)" : " (등록된 업무는 유지됨)";

        meetingRepository.delete(meeting);
        runAfterCommit(() ->
            ragIngestService.deleteSourceBestEffort(meeting.getProjectId(), "meeting", meetingDbId)
        );
        linkedTasks.forEach(task ->
            runAfterCommit(() ->
                ragIngestService.deleteSourceBestEffort(task.getProjectId(), "task", task.getId())
            )
        );
        linkedActionItems.forEach(item ->
            runAfterCommit(() ->
                ragIngestService.deleteSourceBestEffort(meeting.getProjectId(), "action_item", item.getId())
            )
        );
        deleteUploadedFile(filePath);

        notificationService.notifyActorAndCounterpart(
            actorId, "MEETING_DELETED", "회의록을 삭제했습니다",
            "'" + title + "' 회의록을 삭제했습니다." + scopeSuffix,
            uploaderId, "MEETING_DELETED", "회의록이 삭제되었습니다",
            actorName + "님이 '" + title + "' 회의록을 삭제했습니다." + scopeSuffix,
            "meeting", meetingDbId
        );
        return new MeetingDeleteResponse(meetingId, "DELETED");
    }

    @Transactional
    public TaskRegisterResponse registerTasks(String projectId, String meetingId, TaskRegisterRequest request) {
        Meeting meeting = requireProjectMeeting(projectId, meetingId);
        if (meeting == null) return null;
        Long meetingDbId = parseLongOrNull(meetingId);
        List<MeetingTodo> todos = request == null || request.todos() == null ? List.of() : request.todos();
        Long registeredBy = CurrentUser.id();

        int registeredCount = 0;
        for (MeetingTodo todo : todos) {
            if (registerSingleTask(meetingDbId, todo, registeredBy)) {
                registeredCount++;
            }
        }
        String registeredByName = defaultString(resolveNameById(registeredBy), "팀장");
        notificationService.notifyActorAndCounterpart(
            registeredBy, "MEETING_TASKS_REGISTERED", "역할분배 및 업무등록이 완료되었습니다",
            "'" + meeting.getTitle() + "' 회의록의 역할분배 및 업무등록이 완료되었습니다.",
            meeting.getUploadedBy(), "MEETING_TASKS_REGISTERED_NOTIFY_MEMBER", "역할분배가 완료되었습니다",
            registeredByName + "님이 '" + meeting.getTitle() + "' 회의록의 역할분배를 완료했습니다. 확인해주세요.",
            "meeting", meetingDbId
        );
        return new TaskRegisterResponse(meetingId, registeredCount, "REGISTERED");
    }

    @Transactional
    // 저장 확정은 별도 알림을 보내지 않는다 — 회의록 분석 완료 시(MeetingAnalysisPersistence)
    // 이미 MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER 알림이 발송되며, 사용자 관점에서 "저장 = 분석"이라
    // 같은 사건에 대해 알림이 두 번 가는 것을 막는다.
    public MeetingSaveResponse confirmSave(String projectId, String meetingId) {
        Meeting meeting = requireProjectMeeting(projectId, meetingId);
        if (meeting == null) return null;
        meeting.markSaved();
        meetingRepository.save(meeting);
        return new MeetingSaveResponse(meetingId, "SAVED");
    }

    @Transactional
    public MeetingVersionResponse createVersion(String projectId, String meetingId, MeetingVersionRequest request) {
        if (request == null || request.transcript() == null || request.transcript().isBlank()) {
            throw new IllegalArgumentException("수정할 회의록 원문(transcript)은 비워둘 수 없습니다.");
        }
        Meeting original = requireProjectMeeting(projectId, meetingId);
        if (original == null) return null;

        // 경로 파라미터로 받은 회의록이 이미 버전(originalMeetingId != null)이면 최초 원본을 기준으로 제목을 계산한다.
        // 루트를 비관적 락(FOR UPDATE)으로 조회해서, 같은 원본에 대한 동시 수정본 생성 요청을
        // 트랜잭션 단위로 직렬화한다.
        Long rootId = original.getOriginalMeetingId() != null ? original.getOriginalMeetingId() : original.getId();
        // 락 없이 계속 진행하면 동시성 보장이 깨지므로, 루트 조회 실패는 폴백하지 않고 즉시 실패시킨다.
        Meeting lockedRoot = meetingRepository.findByIdForUpdate(rootId)
            .orElseThrow(() -> new IllegalStateException("원본 회의록을 찾을 수 없습니다: " + rootId));
        String rootTitle = lockedRoot.getTitle();

        String versionTitle = nextAvailableVersionTitle(rootId, rootTitle);

        Long editorId = CurrentUser.id();
        Meeting version = meetingRepository.save(Meeting.newVersion(original, request.transcript(), editorId, versionTitle));
        version.markSaved();
        meetingRepository.save(version);

        notifyEdited(original, version, editorId);

        if (!request.triggerAnalysis()) {
            return new MeetingVersionResponse(String.valueOf(version.getId()), "SAVED");
        }

        AiAnalyzeRequest aiRequest = new AiAnalyzeRequest(
            projectId,
            version.getTitle(),
            version.getMeetingDate() == null ? LocalDate.now().toString() : version.getMeetingDate().toString(),
            defaultString(version.getMeetingType(), "정기회의"),
            defaultString(version.getFileType(), "document"),
            version.getOriginalFileName(),
            request.transcript(),
            List.of()
        );
        UUID jobId = UUID.randomUUID();
        version.setAnalysisStatus("processing");
        version.setAnalysisJobId(jobId);
        meetingRepository.save(version);
        runAnalysisAfterCommit(version.getId(), aiRequest, jobId);
        return new MeetingVersionResponse(String.valueOf(version.getId()), "PROCESSING");
    }

    // count 기반 접미사는 중간 버전이 삭제돼 번호에 공백이 생기면 이미 존재하는 제목을 다시 만들어낼 수 있으므로,
    // 루트 락으로 직렬화된 상태에서 실제로 존재하지 않는 제목을 찾을 때까지 순차 확인한다.
    private String nextAvailableVersionTitle(Long rootId, String rootTitle) {
        String candidate = rootTitle + "_수정본";
        int suffix = 2;
        while (meetingRepository.existsByOriginalMeetingIdAndTitle(rootId, candidate)) {
            candidate = rootTitle + "_수정본" + suffix;
            suffix++;
        }
        return candidate;
    }

    /** 수정본 저장/분석 시 수정한 본인 + 반대편(팀장 또는 원본 업로더)에게 알린다. */
    private void notifyEdited(Meeting original, Meeting version, Long editorId) {
        Long leaderId = projectMemberRepository.findByProjectIdAndRole(original.getProjectId(), ProjectRole.LEADER)
            .map(ProjectMember::getUserId)
            .orElse(null);
        Long counterpartId = editorId != null && editorId.equals(leaderId) ? original.getUploadedBy() : leaderId;
        String editorName = defaultString(resolveNameById(editorId), "누군가");
        notificationService.notifyActorAndCounterpart(
            editorId, "MEETING_EDITED", "회의록을 수정했습니다",
            "'" + original.getTitle() + "' 회의록을 수정했습니다.",
            counterpartId, "MEETING_EDITED", "회의록이 수정되었습니다",
            editorName + "님이 '" + original.getTitle() + "' 회의록을 수정했습니다.",
            "meeting", version.getId()
        );
    }

    private boolean registerSingleTask(Long meetingId, MeetingTodo todo, Long createdBy) {
        Long assigneeId = resolveAssignee(todo.assignee_id());
        LocalDate dueDate = parseDateOrNull(todo.due_date());

        Optional<MeetingActionItem> existingItem =
            meetingActionItemRepository.findFirstByMeetingIdAndTitle(meetingId, todo.title());
        if (existingItem.isPresent() && existingItem.get().getCreatedTaskId() != null) {
            return false;
        }

        Optional<Task> existingTask = taskRepository.findFirstBySourceMeetingIdAndTitleAndAssigneeIdAndDueDate(
            meetingId, todo.title(), assigneeId, dueDate
        );
        if (existingTask.isPresent()) {
            existingItem.ifPresent(item -> {
                item.setCreatedTaskId(existingTask.get().getId());
                meetingActionItemRepository.save(item);
            });
            return false;
        }

        Meeting meeting = meetingRepository.findById(meetingId).orElse(null);
        Long taskProjectId = meeting == null ? null : meeting.getProjectId();
        if (taskProjectId != null && dueDate != null) {
            projectRepository.findById(taskProjectId)
                .ifPresent(project -> ProjectSchedulePolicy.validate(project, null, dueDate, "업무"));
        }
        double position = taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(taskProjectId, "todo")
            .map(t -> t.getPosition() + 1)
            .orElse(0.0);
        Task task = taskRepository.save(new Task(
            taskProjectId,
            todo.title(),
            defaultString(todo.category(), "ETC"),
            "todo",
            assigneeId,
            dueDate,
            defaultString(todo.priority(), "MEDIUM"),
            todo.description(),
            "MEETING_AI",
            meetingId,
            createdBy,
            position
        ));
        String taskRagContent = buildTaskIngestContent(task);
        ragIngestService.recordIngestIntent(
            task.getProjectId(),
            "task",
            task.getId(),
            taskRagContent,
            task.getAssigneeId()
        );
        runAfterCommit(() ->
            ragIngestService.ingestBestEffort(
                task.getProjectId(),
                "task",
                task.getId(),
                taskRagContent,
                task.getAssigneeId()
            )
        );

        MeetingActionItem item = existingItem.orElseGet(() -> new MeetingActionItem(
            meetingId, todo.title(), todo.description(), todo.category(),
            resolveAssigneeByName(todo.assignee_candidate()), assigneeId, dueDate, todo.priority(), todo.evidence_text()
        ));
        item.setFinalAssigneeId(assigneeId);
        item.setDueDate(dueDate);
        item.setApproved(true);
        item.setCreatedTaskId(task.getId());
        meetingActionItemRepository.save(item);

        if (assigneeId != null) {
            notificationRepository.save(new Notification(
                assigneeId,
                "TASK_ASSIGNED",
                "새 업무가 배정되었습니다",
                "'" + todo.title() + "' 업무가 배정되었습니다.",
                "task",
                task.getId()
            ));
        }
        return true;
    }

    /** 요청한 사용자가 projectId 프로젝트의 멤버인지 확인하고, 실제 DB projectId를 반환한다. 멤버가 아니면 403. */
    private Long requireProjectMember(String projectIdParam) {
        Long projectDbId = demoDataService.resolveProjectId(projectIdParam);
        Long userId = CurrentUser.id();
        if (!projectMemberRepository.existsByProjectIdAndUserId(projectDbId, userId)) {
            throw new AccessDeniedException("프로젝트 멤버만 접근할 수 있습니다.");
        }
        return projectDbId;
    }

    /**
     * 컨트롤러의 @PreAuthorize에만 기대지 않고 서비스 레이어에서도 팀장 권한을 다시 확인한다
     * (다른 서비스나 배치 작업이 이 메서드를 직접 호출해도 권한 우회가 일어나지 않도록 방어).
     */
    private void requireLeader(Long projectDbId) {
        Long userId = CurrentUser.id();
        boolean isLeader = projectMemberRepository.findByProjectIdAndUserId(projectDbId, userId)
            .map(member -> member.getRole() == ProjectRole.LEADER)
            .orElse(false);
        if (!isLeader) {
            throw new AccessDeniedException("팀장만 회의록을 삭제할 수 있습니다.");
        }
    }

    /**
     * 요청한 사용자가 projectId 멤버인지 확인(아니면 403)한 뒤, meetingId가 실제로 그 프로젝트
     * 소속인 회의록인지 조회한다. 다른 프로젝트의 회의록이거나 존재하지 않으면 null(404)을 반환한다.
     */
    private Meeting requireProjectMeeting(String projectIdParam, String meetingIdParam) {
        Long projectDbId = requireProjectMember(projectIdParam);
        Long meetingDbId = parseLongOrNull(meetingIdParam);
        if (meetingDbId == null) return null;
        return meetingRepository.findByIdAndProjectId(meetingDbId, projectDbId).orElse(null);
    }

    private void validateAttendeeIds(Long projectId, List<Long> attendeeIds) {
        for (Long attendeeId : attendeeIds) {
            if (!projectMemberRepository.existsByProjectIdAndUserId(projectId, attendeeId)) {
                throw new IllegalArgumentException("프로젝트 멤버가 아닌 참석자가 포함되어 있습니다: " + attendeeId);
            }
        }
    }

    private void saveAttendeesByIds(Long meetingId, List<Long> attendeeIds) {
        for (Long userId : attendeeIds.stream().distinct().toList()) {
            meetingAttendeeRepository.save(new MeetingAttendee(meetingId, userId));
        }
    }

    private List<AttendeeSummary> buildAttendeeSummaries(Long meetingId, Long projectId) {
        List<MeetingAttendee> attendeeRows = meetingAttendeeRepository.findByMeetingId(meetingId);
        if (attendeeRows.isEmpty()) return List.of();

        Map<Long, User> usersById = userRepository
            .findAllById(attendeeRows.stream().map(MeetingAttendee::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, user -> user));
        Map<Long, ProjectMember> membersByUserId = projectMemberRepository.findAllByProjectId(projectId).stream()
            .collect(Collectors.toMap(ProjectMember::getUserId, member -> member));

        return attendeeRows.stream()
            .map(attendee -> {
                User user = usersById.get(attendee.getUserId());
                ProjectMember member = membersByUserId.get(attendee.getUserId());
                return new AttendeeSummary(
                    attendee.getUserId(),
                    user != null ? user.getName() : null,
                    member != null ? member.getRole().toKorean() : null
                );
            })
            .toList();
    }

    private Long resolveAssigneeByName(String name) {
        if (name == null || name.isBlank()) return null;
        return userRepository.findFirstByName(name).map(User::getId).orElse(null);
    }

    private MeetingTodo toMeetingTodo(MeetingActionItem item) {
        return new MeetingTodo(
            item.getTitle(),
            item.getDescription(),
            resolveNameById(item.getRecommendedAssigneeId()),
            item.getFinalAssigneeId() == null ? null : String.valueOf(item.getFinalAssigneeId()),
            item.getDueDate() == null ? null : item.getDueDate().toString(),
            item.getPriority(),
            item.getCategory(),
            item.getFinalAssigneeId() == null,
            item.getBasis() == null ? "" : item.getBasis()
        );
    }

    private String resolveNameById(Long userId) {
        if (userId == null) return null;
        return userRepository.findById(userId).map(User::getName).orElse(null);
    }

    private String storeUploadedFile(Long meetingId, MultipartFile file) {
        if (file == null || file.isEmpty()) return null;
        try {
            Path dir = Path.of(uploadsDir, String.valueOf(meetingId)).toAbsolutePath().normalize();
            Files.createDirectories(dir);
            String safeName = sanitizeFileName(file.getOriginalFilename());
            Path target = dir.resolve(safeName).normalize();
            if (!target.startsWith(dir)) {
                throw new IOException("Invalid upload file name: " + file.getOriginalFilename());
            }
            file.transferTo(target);
            return target.toString();
        } catch (IOException e) {
            return null;
        }
    }

    private String sanitizeFileName(String originalFilename) {
        if (originalFilename == null || originalFilename.isBlank()) return "upload.bin";
        String name = originalFilename.replace('\\', '/');
        int slashIndex = name.lastIndexOf('/');
        if (slashIndex >= 0) {
            name = name.substring(slashIndex + 1);
        }
        name = name.replaceAll("[\\p{Cntrl}:*?\"<>|]+", "_").trim();
        if (name.isBlank() || ".".equals(name) || "..".equals(name)) {
            return "upload.bin";
        }
        return name;
    }

    private void deleteUploadedFile(String filePath) {
        if (filePath == null || filePath.isBlank()) return;
        try {
            Path target = Path.of(filePath).toAbsolutePath().normalize();
            Files.deleteIfExists(target);
            Path parent = target.getParent();
            if (parent != null && Files.isDirectory(parent)) {
                try (var children = Files.list(parent)) {
                    if (children.findAny().isEmpty()) {
                        Files.deleteIfExists(parent);
                    }
                }
            }
        } catch (IOException ignored) {
            // 파일 삭제 실패는 회의록 DB 삭제를 막지 않는다.
        }
    }

    private void saveAttendees(Long meetingId, Long projectId, List<String> participantNames) {
        Set<Long> savedUserIds = new HashSet<>();
        for (String name : participantNames) {
            userRepository.findFirstByName(name)
                .filter(user -> projectMemberRepository.existsByProjectIdAndUserId(projectId, user.getId()))
                .filter(user -> savedUserIds.add(user.getId()))
                .ifPresent(user -> meetingAttendeeRepository.save(new MeetingAttendee(meetingId, user.getId())));
        }
    }

    private void runAnalysisAfterCommit(Long meetingId, AiAnalyzeRequest request, UUID jobId) {
        runAfterCommit(() -> enqueueSafely(meetingId, request, jobId));
    }

    private void runAfterCommit(Runnable operation) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            runAfterCommitOperationSafely(operation);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                runAfterCommitOperationSafely(operation);
            }
        });
    }

    private void runAfterCommitOperationSafely(Runnable operation) {
        try {
            operation.run();
        } catch (RuntimeException exception) {
            log.warn("after-commit 작업 제출 실패. errorType={}", exception.getClass().getSimpleName());
        }
    }

    private void enqueueSafely(Long meetingId, AiAnalyzeRequest request, UUID jobId) {
        try {
            meetingAnalysisJobPublisher.enqueue(meetingId, request, jobId);
        } catch (RuntimeException exception) {
            log.warn(
                "Failed to enqueue meeting analysis job: meetingId={}, cause={}",
                meetingId,
                exception.getClass().getSimpleName()
            );
            meetingAnalysisPersistence.saveAnalysisFailureInNewTransaction(
                meetingId,
                MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE,
                jobId
            );
        }
    }

    private String toResponseProjectId(Long projectDbId) {
        try {
            Long demoProjectId = demoDataService.resolveProjectId("demo-project");
            if (demoProjectId != null && demoProjectId.equals(projectDbId)) {
                return "demo-project";
            }
        } catch (Exception ignored) {
            // 데모 시딩이 꺼진 운영 환경에서는 DB id를 그대로 응답한다.
        }
        return String.valueOf(projectDbId);
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

    private LocalDate parseDateOrNull(String date) {
        if (date == null || date.isBlank()) return null;
        try {
            return LocalDate.parse(date);
        } catch (Exception e) {
            return null;
        }
    }

    private Long parseLongOrNull(String value) {
        try {
            return Long.parseLong(value);
        } catch (Exception e) {
            return null;
        }
    }

    private List<String> safeParticipants(List<String> participants) {
        if (participants == null) return List.of();
        return participants.stream().filter(p -> p != null && !p.isBlank()).toList();
    }

    private String extractText(MultipartFile file) {
        if (file == null || file.isEmpty()) return "";
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        boolean textLike = contentType.startsWith("text/")
            || name.endsWith(".txt")
            || name.endsWith(".md")
            || name.endsWith(".csv")
            || name.endsWith(".json");
        if (name.endsWith(".docx")) {
            return extractDocxText(file);
        }
        if (name.endsWith(".pdf") || contentType.equals("application/pdf")) {
            return extractPdfText(file);
        }
        if (name.endsWith(".pptx")) {
            return extractPptxText(file);
        }
        if (name.endsWith(".ppt")) {
            return extractPptText(file);
        }
        if (name.endsWith(".doc")) {
            return extractDocText(file);
        }
        if (!textLike) {
            return "업로드 파일명: " + file.getOriginalFilename() + ". 바이너리 문서는 FastAPI 문서 파서 또는 STT 단계에서 텍스트 추출 예정.";
        }
        try {
            return new String(file.getBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalArgumentException("회의록 파일을 읽을 수 없습니다.");
        }
    }

    /** 음성 파일은 analyze()에서 STT를 건너뛰고 비동기 큐(MeetingAnalysisRunner)로 넘기므로 extractText()가 호출되지 않는다. */
    private boolean isAudioFile(String lowerCaseFileName) {
        return AUDIO_FILE_EXTENSIONS.stream().anyMatch(lowerCaseFileName::endsWith);
    }

    private void validateAudioFileSize(MultipartFile file) {
        if (file.getSize() > MAX_AUDIO_FILE_SIZE_BYTES) {
            throw new IllegalArgumentException(
                "음성 파일 크기는 " + (MAX_AUDIO_FILE_SIZE_BYTES / (1024 * 1024)) + "MB를 초과할 수 없습니다."
            );
        }
    }

    private String extractTextFromStoredFile(Meeting meeting) {
        String filePath = meeting.getFilePath();
        if (filePath == null || filePath.isBlank()) return "";
        String fileName = meeting.getOriginalFileName() == null ? "" : meeting.getOriginalFileName().toLowerCase();
        boolean textLike = fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".csv") || fileName.endsWith(".json");
        try {
            byte[] bytes = Files.readAllBytes(Path.of(filePath));
            if (fileName.endsWith(".docx")) {
                return extractDocxTextFromBytes(bytes);
            }
            if (fileName.endsWith(".pdf")) {
                return extractPdfTextFromBytes(bytes);
            }
            if (!textLike) {
                return null;
            }
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (IOException | IllegalArgumentException e) {
            log.warn("회의록 재분석용 파일 텍스트 추출 실패: meetingId={}, filePath={}", meeting.getId(), filePath, e);
            return "";
        }
    }

    private String extractDocxText(MultipartFile file) {
        try {
            return extractDocxTextFromBytes(file.getBytes());
        } catch (IOException e) {
            throw new IllegalArgumentException("DOCX 회의록을 읽을 수 없습니다.");
        }
    }

    private String extractPdfText(MultipartFile file) {
        try {
            return extractPdfTextFromBytes(file.getBytes());
        } catch (IOException e) {
            throw new IllegalArgumentException("PDF 회의록을 읽을 수 없습니다.");
        }
    }

    private String extractPptxText(MultipartFile file) {
        try (org.apache.poi.xslf.usermodel.XMLSlideShow slideShow =
                 new org.apache.poi.xslf.usermodel.XMLSlideShow(file.getInputStream())) {
            StringBuilder text = new StringBuilder();
            for (org.apache.poi.xslf.usermodel.XSLFSlide slide : slideShow.getSlides()) {
                for (org.apache.poi.sl.usermodel.Shape<?, ?> shape : slide.getShapes()) {
                    if (shape instanceof org.apache.poi.xslf.usermodel.XSLFTextShape textShape) {
                        String shapeText = textShape.getText();
                        if (shapeText != null && !shapeText.isBlank()) {
                            text.append(shapeText).append("\n");
                        }
                    }
                }
            }
            String result = text.toString().trim();
            if (result.isBlank()) {
                throw new IllegalArgumentException("PPTX에서 분석할 텍스트를 추출하지 못했습니다.");
            }
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("PPTX 텍스트 추출에 실패했습니다.");
        }
    }

    private String extractPptText(MultipartFile file) {
        try (org.apache.poi.hslf.usermodel.HSLFSlideShow slideShow =
                 new org.apache.poi.hslf.usermodel.HSLFSlideShow(file.getInputStream())) {
            StringBuilder text = new StringBuilder();
            for (org.apache.poi.hslf.usermodel.HSLFSlide slide : slideShow.getSlides()) {
                for (org.apache.poi.hslf.usermodel.HSLFShape shape : slide.getShapes()) {
                    if (shape instanceof org.apache.poi.hslf.usermodel.HSLFTextShape textShape) {
                        String shapeText = textShape.getText();
                        if (shapeText != null && !shapeText.isBlank()) {
                            text.append(shapeText).append("\n");
                        }
                    }
                }
            }
            String result = text.toString().trim();
            if (result.isBlank()) {
                throw new IllegalArgumentException("PPT에서 분석할 텍스트를 추출하지 못했습니다.");
            }
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("PPT 텍스트 추출에 실패했습니다.");
        }
    }

    private String extractDocText(MultipartFile file) {
        try (org.apache.poi.hwpf.HWPFDocument document = new org.apache.poi.hwpf.HWPFDocument(file.getInputStream())) {
            String result = document.getDocumentText().trim();
            if (result.isBlank()) {
                throw new IllegalArgumentException("DOC에서 분석할 텍스트를 추출하지 못했습니다.");
            }
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("DOC 텍스트 추출에 실패했습니다.");
        }
    }

    private String extractPdfTextFromBytes(byte[] bytes) {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            String text = new PDFTextStripper()
                .getText(document)
                .replaceAll("\\s+\\n", "\n")
                .replaceAll("\\n\\s+", "\n")
                .trim();
            if (text.isBlank()) {
                throw new IllegalArgumentException("PDF에서 분석할 텍스트를 추출하지 못했습니다.");
            }
            return text;
        } catch (IOException ignored) {
            throw new IllegalArgumentException("PDF 텍스트 추출에 실패했습니다.");
        }
    }

    private String extractDocxTextFromBytes(byte[] bytes) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (!"word/document.xml".equals(entry.getName())) continue;
                String xml = new String(zip.readAllBytes(), StandardCharsets.UTF_8);
                String text = xml
                    .replaceAll("<w:p[^>]*>", "\n")
                    .replaceAll("<[^>]+>", " ")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&")
                    .replace("&quot;", "\"")
                    .replace("&apos;", "'")
                    .replaceAll("\\s+", " ")
                    .trim();
                if (text.isBlank()) {
                    throw new IllegalArgumentException("DOCX에서 분석할 텍스트를 추출하지 못했습니다.");
                }
                return text;
            }
        } catch (IOException ignored) {
            throw new IllegalArgumentException("DOCX 텍스트 추출에 실패했습니다.");
        }
        throw new IllegalArgumentException("DOCX 본문을 찾을 수 없습니다.");
    }

    private String defaultString(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private String buildTaskIngestContent(Task task) {
        StringBuilder content = new StringBuilder(task.getTitle());
        if (task.getDescription() != null && !task.getDescription().isBlank()) {
            content.append(" - ").append(task.getDescription());
        }
        return content.toString();
    }
}
