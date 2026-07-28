package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.rag.RagIngestService;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@ExtendWith(MockitoExtension.class)
class MeetingAnalysisPersistenceTest {

    @Mock private MeetingRepository meetingRepository;
    @Mock private MeetingAnalysisRepository meetingAnalysisRepository;
    @Mock private MeetingActionItemRepository meetingActionItemRepository;
    @Mock private MeetingAttendeeRepository meetingAttendeeRepository;
    @Mock private UserRepository userRepository;
    @Mock private DemoDataService demoDataService;
    @Mock private RagIngestService ragIngestService;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private NotificationService notificationService;
    @Mock private PlatformTransactionManager transactionManager;

    private MeetingAnalysisPersistence newPersistence() {
        return new MeetingAnalysisPersistence(
            meetingRepository, meetingAnalysisRepository, meetingActionItemRepository, meetingAttendeeRepository,
            userRepository, demoDataService, ragIngestService, projectMemberRepository, notificationService,
            transactionManager
        );
    }

    private Meeting newMeeting() {
        return new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", null, 10L);
    }

    private void stubSaves() {
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(meetingActionItemRepository.save(any(MeetingActionItem.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private void stubMember(String name, Long userId) {
        User user = mock(User.class);
        when(user.getId()).thenReturn(userId);
        when(userRepository.findFirstByName(name)).thenReturn(Optional.of(user));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, userId)).thenReturn(true);
    }

    @Test
    void saveAnalysisSuccessMarksMeetingCompletedAndStoresTodos() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        stubSaves();

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약",
            List.of("결정1"),
            List.of(new MeetingTodo("업무1", "설명", "김민준", null, "2026-07-20", "HIGH", "ETC", true)),
            List.of("위험1"),
            List.of("키워드1"),
            new MeetingMeta("정기회의", "2026-07-15", List.of("김민준"))
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getValue().getAnalysisStatus()).isEqualTo("completed");

        ArgumentCaptor<MeetingAnalysis> analysisCaptor = ArgumentCaptor.forClass(MeetingAnalysis.class);
        verify(meetingAnalysisRepository).save(analysisCaptor.capture());
        MeetingAnalysis savedAnalysis = analysisCaptor.getValue();
        assertThat(savedAnalysis.getSummary()).isEqualTo("요약");
        assertThat(savedAnalysis.getDecisions()).isEqualTo(List.of("결정1"));
        assertThat(savedAnalysis.getRisks()).isEqualTo(List.of("위험1"));
        assertThat(savedAnalysis.getKeywords()).isEqualTo(List.of("키워드1"));
        assertThat(savedAnalysis.getAnalysisEngine()).isEqualTo("FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository).save(actionItemCaptor.capture());
        MeetingActionItem savedActionItem = actionItemCaptor.getValue();
        assertThat(savedActionItem.getTitle()).isEqualTo("업무1");
        assertThat(savedActionItem.getDescription()).isEqualTo("설명");
        assertThat(savedActionItem.getCategory()).isEqualTo("ETC");
        assertThat(savedActionItem.getPriority()).isEqualTo("HIGH");
        assertThat(savedActionItem.getDueDate()).isEqualTo(LocalDate.parse("2026-07-20"));
        assertThat(savedActionItem.getRecommendedAssigneeId()).isNull();
        assertThat(savedActionItem.getFinalAssigneeId()).isNull();
        verify(ragIngestService).ingestBestEffort(1L, "meeting", 5L, "요약\n결정사항: 결정1\n위험요소: 위험1");
    }

    @Test
    void saveAnalysisSuccessStillCompletesWhenNotificationFails() {
        // 알림 발송은 부가 기능이라 실패해도 분석 결과 저장(@Transactional) 자체는 롤백되면 안 된다.
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));
        doThrow(new RuntimeException("notification service down"))
            .when(notificationService).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getValue().getAnalysisStatus()).isEqualTo("completed");
    }

    @Test
    void notificationIsDeferredUntilAfterCommitWhenTransactionSynchronizationIsActive() {
        // @Transactional 호출 경로를 흉내내기 위해 트랜잭션 동기화를 직접 활성화한다.
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        TransactionSynchronizationManager.initSynchronization();
        try {
            persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

            verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
            verify(ragIngestService, never()).ingestBestEffort(any(), any(), any(), any());

            List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
            assertThat(synchronizations).hasSize(2);
            synchronizations.forEach(TransactionSynchronization::afterCommit);

            verify(ragIngestService).ingestBestEffort(1L, "meeting", 5L, "요약");
            verify(notificationService).notifyAfterCommit(eq(99L), eq("MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER"),
                any(), any(), eq("meeting"), eq(5L), eq(1L));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void notificationIsNeverSentWhenTransactionRollsBackWithoutCommit() {
        // afterCommit 콜백이 한 번도 호출되지 않는 롤백 상황을 흉내낸다.
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        TransactionSynchronizationManager.initSynchronization();
        try {
            persistence.saveAnalysisSuccess(5L, result, "FASTAPI");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void saveAnalysisSuccessNotifiesLeaderWhenUploaderIsMember() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        verify(notificationService).notifyAfterCommit(
            eq(99L), eq("MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER"), any(), any(), eq("meeting"), eq(5L), eq(1L)
        );
        // 분석을 실행한 본인(10L)에게는 알림이 가지 않는다.
        verify(notificationService, never()).notifyAfterCommit(eq(10L), any(), any(), any(), any(), any(), any());
    }

    @Test
    void saveAnalysisSuccessSendsNoNotificationWhenUploaderIsLeader() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 99L, 10L);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        // 팀장 본인이 올리고 분석까지 했으므로 알릴 상대가 없다.
        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void saveAnalysisSuccessForJobCreditsTheActualRequesterNotTheOriginalUploader() {
        // 원본 업로더(10L)가 아니라, 이번 재분석을 실제로 트리거한 사용자(20L)가 완료 알림에
        // 크레딧돼야 한다 — 예: A가 업로드한 회의록을 B가 재시도(retry)한 경우.
        MeetingAnalysisPersistence persistence = newPersistence();
        UUID jobId = UUID.randomUUID();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        meeting.setAnalysisJobId(jobId);
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of());
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectMember leaderMember = new ProjectMember(1L, 99L, com.workflowai.project.ProjectRole.LEADER);
        when(projectMemberRepository.findByProjectIdAndRole(1L, com.workflowai.project.ProjectRole.LEADER))
            .thenReturn(Optional.of(leaderMember));
        User requester = mock(User.class);
        when(requester.getName()).thenReturn("박지수");
        when(userRepository.findById(20L)).thenReturn(Optional.of(requester));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );

        persistence.saveAnalysisSuccessForJob(5L, result, "FASTAPI", jobId, 20L);

        ArgumentCaptor<String> contentCaptor = ArgumentCaptor.forClass(String.class);
        verify(notificationService).notifyAfterCommit(
            eq(99L), eq("MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER"), any(), contentCaptor.capture(),
            eq("meeting"), eq(5L), eq(1L)
        );
        assertThat(contentCaptor.getValue()).contains("박지수님이");
        // 원본 업로더(10L)에게도, 재분석을 실행한 본인(20L)에게도 알림이 가지 않는다.
        verify(notificationService, never()).notifyAfterCommit(eq(10L), any(), any(), any(), any(), any(), any());
        verify(notificationService, never()).notifyAfterCommit(eq(20L), any(), any(), any(), any(), any(), any());
    }

    @Test
    void assignsTodoWhenCandidateIsProjectMemberAndMeetingAttendee() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        stubSaves();
        stubMember("박지수", 3L);
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of(new MeetingAttendee(5L, 3L)));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약",
            List.of("결정1"),
            List.of(new MeetingTodo("업무1", "설명", "박지수", null, "2026-07-20", "HIGH", "ETC", true)),
            List.of("위험1"),
            List.of("키워드1"),
            new MeetingMeta("정기회의", "2026-07-15", List.of("박지수"))
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository).save(actionItemCaptor.capture());
        assertThat(actionItemCaptor.getValue().getFinalAssigneeId()).isEqualTo(3L);
    }

    @Test
    void assignsTodoUsingRootMeetingAttendeesWhenMeetingIsAVersion() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting version = newMeeting();
        // 버전(수정본)은 원본 회의록(id=5)을 가리킨다. 버전 자신(id=6)에는 참석자 행이 없다는 것이
        // 이 테스트의 핵심 전제 — meetingAttendeeRepository.findByMeetingId(6L)은 스텁하지 않으므로
        // Mockito 기본값(빈 리스트)을 반환하며, 이것이 실제 운영 데이터 상태를 그대로 재현한다.
        org.springframework.test.util.ReflectionTestUtils.setField(version, "originalMeetingId", 5L);
        when(meetingRepository.findByIdForUpdate(6L)).thenReturn(Optional.of(version));
        stubSaves();
        stubMember("박지수", 3L);
        // 원본 회의록(id=5)에는 참석자가 등록되어 있다.
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of(new MeetingAttendee(5L, 3L)));

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약",
            List.of("결정1"),
            List.of(new MeetingTodo("업무1", "설명", "박지수", null, "2026-07-20", "HIGH", "ETC", true)),
            List.of("위험1"),
            List.of("키워드1"),
            new MeetingMeta("정기회의_수정본", "2026-07-15", List.of("박지수"))
        );

        persistence.saveAnalysisSuccess(6L, result, "FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository).save(actionItemCaptor.capture());
        assertThat(actionItemCaptor.getValue().getFinalAssigneeId()).isEqualTo(3L);
    }

    @Test
    void leavesTodoUnassignedWhenCandidateIsProjectMemberButNotMeetingAttendee() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        stubSaves();
        // 유소은은 프로젝트 멤버지만 이번 회의의 참석자로 체크되지 않았다.
        // 참석자 여부를 먼저 검사하므로 프로젝트 멤버십 조회 자체가 호출되지 않는다.
        User outsider = mock(User.class);
        when(outsider.getId()).thenReturn(9L);
        when(userRepository.findFirstByName("유소은")).thenReturn(Optional.of(outsider));
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(
            List.of(new MeetingAttendee(5L, 1L), new MeetingAttendee(5L, 2L))
        );

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약",
            List.of("결정1"),
            List.of(new MeetingTodo("업무1", "설명", "유소은", null, "2026-07-20", "HIGH", "ETC", true)),
            List.of("위험1"),
            List.of("키워드1"),
            new MeetingMeta("정기회의", "2026-07-15", List.of("김민준", "이서연"))
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository).save(actionItemCaptor.capture());
        assertThat(actionItemCaptor.getValue().getFinalAssigneeId()).isNull();
        assertThat(actionItemCaptor.getValue().getRecommendedAssigneeId()).isEqualTo(9L);
    }

    @Test
    void leavesTodoUnassignedWhenCandidateIsNotProjectMemberOrSystemUser() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        stubSaves();
        when(userRepository.findFirstByName("고무서")).thenReturn(Optional.empty());
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(
            List.of(new MeetingAttendee(5L, 1L), new MeetingAttendee(5L, 2L))
        );

        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약",
            List.of("결정1"),
            List.of(new MeetingTodo("업무1", "설명", "고무서", null, "2026-07-20", "HIGH", "ETC", true)),
            List.of("위험1"),
            List.of("키워드1"),
            new MeetingMeta("정기회의", "2026-07-15", List.of("김민준", "이서연"))
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository).save(actionItemCaptor.capture());
        assertThat(actionItemCaptor.getValue().getFinalAssigneeId()).isNull();
        assertThat(actionItemCaptor.getValue().getRecommendedAssigneeId()).isNull();
    }

    @Test
    void onlyAttendeeMatchedCandidateIsAssignedAmongManyBodyNames() {
        // 업로드 시 체크된 참석자: 김민준, 이서연, 박지수, 최동혁.
        // 회의록 본문에는 고무서/곽진아/박지수/허영주/유소은/박상준/이은주가 담당자로 언급된다.
        // 참석자이자 프로젝트 멤버인 박지수만 자동 배정되고 나머지는 모두 미배정이어야 한다.
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        stubSaves();

        Map<String, Long> outsiderIds = Map.of(
            "고무서", 101L, "곽진아", 102L, "허영주", 103L,
            "유소은", 104L, "박상준", 105L, "이은주", 106L
        );
        outsiderIds.forEach((name, userId) -> {
            User outsider = mock(User.class);
            when(outsider.getId()).thenReturn(userId);
            when(userRepository.findFirstByName(name)).thenReturn(Optional.of(outsider));
            // 참석자 여부를 먼저 검사하므로, 참석자가 아닌 이들은 프로젝트 멤버십 조회까지 가지 않는다.
        });
        stubMember("박지수", 3L);

        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of(
            new MeetingAttendee(5L, 1L), // 김민준
            new MeetingAttendee(5L, 2L), // 이서연
            new MeetingAttendee(5L, 3L), // 박지수
            new MeetingAttendee(5L, 4L)  // 최동혁
        ));

        List<MeetingTodo> todos = List.of(
            new MeetingTodo("t1", "설명", "고무서", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t2", "설명", "곽진아", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t3", "설명", "박지수", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t4", "설명", "허영주", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t5", "설명", "유소은", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t6", "설명", "박상준", null, "2026-07-20", "HIGH", "ETC", true),
            new MeetingTodo("t7", "설명", "이은주", null, "2026-07-20", "HIGH", "ETC", true)
        );
        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of("결정1"), todos, List.of("위험1"), List.of("키워드1"),
            new MeetingMeta("정기회의", "2026-07-15", List.of("김민준", "이서연", "박지수", "최동혁"))
        );

        persistence.saveAnalysisSuccess(5L, result, "FASTAPI");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository, org.mockito.Mockito.times(7)).save(actionItemCaptor.capture());
        Map<String, Long> finalAssigneeByTitle = new java.util.HashMap<>();
        actionItemCaptor.getAllValues().forEach(item -> finalAssigneeByTitle.put(item.getTitle(), item.getFinalAssigneeId()));

        assertThat(finalAssigneeByTitle.get("t3")).isEqualTo(3L);
        assertThat(finalAssigneeByTitle.get("t1")).isNull();
        assertThat(finalAssigneeByTitle.get("t2")).isNull();
        assertThat(finalAssigneeByTitle.get("t4")).isNull();
        assertThat(finalAssigneeByTitle.get("t5")).isNull();
        assertThat(finalAssigneeByTitle.get("t6")).isNull();
        assertThat(finalAssigneeByTitle.get("t7")).isNull();
    }

    @Test
    void endToEndCapstoneKickoffTranscriptOnlyAssignsAttendingSpeaker() {
        // FallbackMeetingAnalyzer의 실제 추출 결과를 그대로 persistence에 흘려보내
        // 참석자(김민준, 이서연, 박지수, 최동혁) 중 본문에서 발언한 박지수만 배정되는지 end-to-end로 검증한다.
        String transcript = """
            고무서: 전체 범위와 1주차 개발 목표를 정리하겠습니다.
            곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다. Google OAuth 로그인, JWT 발급, 프로젝트별 팀장/팀원/심사자 권한을 7월 12일까지 기본 구조로 구현하겠습니다.
            박지수: 저는 회의록 AI 분석을 맡겠습니다. 우선 문서 업로드 기반으로 회의 요약, 결정사항, 위험요소, To-Do 후보를 JSON으로 추출하는 기능부터 만들겠습니다.
            허영주: 업무 보드는 네 개 상태로 가면 될 것 같습니다. 회의록에서 생성된 To-Do가 팀장 승인 후 업무 보드에 들어오게 연결하겠습니다.
            유소은: 대시보드는 완료율, 마감 임박 업무, 블로커, 팀원별 업무량을 보여주겠습니다. ML 지연 위험도는 처음에는 규칙 기반으로 만들겠습니다.
            박상준: AI Assistant는 RAG 구조로 설계하겠습니다.
            이은주: 심사자 화면에서는 개인별 기여도 리포트와 AI 평가 근거를 볼 수 있게 하겠습니다.
            곽진아: API 명세는 공통 응답 형식을 맞춰야 합니다.
            박지수: 회의록 분석 결과는 summary, decisions, todos, risks, keywords 형식으로 고정하겠습니다.
            """;
        AiAnalyzeRequest request = new AiAnalyzeRequest(
            "demo-project", "캡스톤디자인 WorkFlow AI 착수 회의", "2026-07-09", "캡스톤디자인",
            "document", "kickoff.txt", transcript, List.of("김민준", "이서연", "박지수", "최동혁")
        );
        MeetingAnalysisResult result = new FallbackMeetingAnalyzer().analyze(request);

        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(meeting));
        stubSaves();
        // 참석자로 체크된 4명 중 프로젝트 멤버이자 회의 참석자로 저장된 사람은 박지수(3L)뿐이다.
        stubMember("박지수", 3L);
        when(meetingAttendeeRepository.findByMeetingId(5L)).thenReturn(List.of(
            new MeetingAttendee(5L, 1L), new MeetingAttendee(5L, 2L),
            new MeetingAttendee(5L, 3L), new MeetingAttendee(5L, 4L)
        ));

        persistence.saveAnalysisSuccess(5L, result, "SPRING_FALLBACK");

        ArgumentCaptor<MeetingActionItem> actionItemCaptor = ArgumentCaptor.forClass(MeetingActionItem.class);
        verify(meetingActionItemRepository, org.mockito.Mockito.atLeastOnce()).save(actionItemCaptor.capture());
        List<MeetingActionItem> savedItems = actionItemCaptor.getAllValues();

        long assignedCount = 0;
        for (MeetingActionItem item : savedItems) {
            Long recommendedId = item.getRecommendedAssigneeId();
            if (recommendedId != null && recommendedId == 3L) {
                // 박지수가 직접 발언한 업무 -> 반드시 박지수에게 배정.
                assertThat(item.getFinalAssigneeId()).as("박지수 발언 업무: " + item.getTitle()).isEqualTo(3L);
                assignedCount++;
            } else {
                // 그 외(비참석자가 발언한 업무, 또는 후보 추출 실패) -> 절대 배정되면 안 됨(박지수에게 몰리는 것 포함).
                assertThat(item.getFinalAssigneeId()).as("비참석자 발언 업무: " + item.getTitle()).isNull();
            }
        }
        assertThat(assignedCount).isGreaterThan(0);
        assertThat(assignedCount).isLessThan(savedItems.size());
    }

    @Test
    void saveAnalysisFailureMarksMeetingFailedWithMessage() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = newMeeting();
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(meeting));

        persistence.saveAnalysisFailure(7L, "FastAPI 연결 실패");

        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getValue().getAnalysisStatus()).isEqualTo("failed");
        verify(meetingAnalysisRepository, never()).save(any());
    }

    @Test
    void duplicateSuccessDoesNotOverwriteTerminalMeeting() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting completed = newMeeting();
        completed.setAnalysisStatus("completed");
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(completed));

        persistence.saveAnalysisSuccess(
            7L,
            new MeetingAnalysisResult(
                "요약", List.of(), List.of(), List.of(), List.of(),
                new MeetingMeta("정기회의", "2026-07-15", List.of())
            ),
            "FASTAPI"
        );

        verify(meetingAnalysisRepository, never()).save(any());
        verify(meetingActionItemRepository, never()).save(any());
        verify(meetingRepository, never()).save(any());
    }

    @Test
    void lateFailureDoesNotOverwriteCompletedMeeting() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting completed = newMeeting();
        completed.setAnalysisStatus("completed");
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(completed));

        persistence.saveAnalysisFailure(7L, "late failure");

        verify(meetingRepository, never()).save(any());
        assertThat(completed.getAnalysisStatus()).isEqualTo("completed");
    }

    @Test
    void staleJobCannotPersistAfterRetryGenerationChanges() {
        MeetingAnalysisPersistence persistence = newPersistence();
        UUID currentJobId = UUID.randomUUID();
        Meeting processing = newMeeting();
        processing.setAnalysisJobId(currentJobId);
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(processing));

        persistence.saveAnalysisFailureForJob(7L, "late failure", UUID.randomUUID());

        verify(meetingRepository, never()).save(any());
        assertThat(processing.getAnalysisStatus()).isEqualTo("processing");
    }

    @Test
    void legacyQueuedJobClaimsNullGenerationBeforeAnalysis() {
        MeetingAnalysisPersistence persistence = newPersistence();
        UUID jobId = UUID.randomUUID();
        Meeting processing = newMeeting();
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(processing));

        boolean claimed = persistence.claimJob(7L, jobId);

        assertThat(claimed).isTrue();
        assertThat(processing.getAnalysisJobId()).isEqualTo(jobId);
        verify(meetingRepository).save(processing);
    }

    @Test
    void staleQueuedJobCannotClaimDifferentGeneration() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting processing = newMeeting();
        processing.setAnalysisJobId(UUID.randomUUID());
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(processing));

        boolean claimed = persistence.claimJob(7L, UUID.randomUUID());

        assertThat(claimed).isFalse();
        verify(meetingRepository, never()).save(any());
    }

    @Test
    void currentJobSuccessCanPromoteEarlierDuplicateFailure() {
        MeetingAnalysisPersistence persistence = newPersistence();
        UUID jobId = UUID.randomUUID();
        Meeting failed = newMeeting();
        failed.setAnalysisStatus("failed");
        failed.setAnalysisJobId(jobId);
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(failed));
        when(meetingAnalysisRepository.save(any(MeetingAnalysis.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(meetingAttendeeRepository.findByMeetingId(7L)).thenReturn(List.of());

        persistence.saveAnalysisSuccessForJob(
            7L,
            new MeetingAnalysisResult(
                "요약", List.of(), List.of(), List.of(), List.of(),
                new MeetingMeta("정기회의", "2026-07-15", List.of())
            ),
            "FASTAPI",
            jobId,
            77L
        );

        verify(meetingAnalysisRepository).save(any(MeetingAnalysis.class));
        assertThat(failed.getAnalysisStatus()).isEqualTo("completed");
    }

    @Test
    void failureNotificationIsDeferredUntilAfterCommitWhenTransactionSynchronizationIsActive() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(meeting));

        TransactionSynchronizationManager.initSynchronization();
        try {
            persistence.saveAnalysisFailure(7L, "FastAPI 연결 실패");

            verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());

            List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
            assertThat(synchronizations).hasSize(1);
            synchronizations.forEach(TransactionSynchronization::afterCommit);

            verify(notificationService).notifyAfterCommit(10L, "MEETING_ANALYSIS_FAILED", "회의 분석에 실패했습니다.",
                "'정기회의' 회의록 분석에 실패했습니다. 다시 시도해주세요.", "meeting", 7L, 1L);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void failureNotificationIsNeverSentWhenTransactionRollsBackWithoutCommit() {
        MeetingAnalysisPersistence persistence = newPersistence();
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        when(meetingRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(meeting));

        TransactionSynchronizationManager.initSynchronization();
        try {
            persistence.saveAnalysisFailure(7L, "FastAPI 연결 실패");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }
}
