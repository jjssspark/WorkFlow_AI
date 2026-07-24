package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationRepository;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@ExtendWith(MockitoExtension.class)
class MeetingAnalysisServiceTest {

    private static final Long CURRENT_USER_ID = 1L;

    @Mock private MeetingAnalysisJobPublisher meetingAnalysisJobPublisher;
    @Mock private DemoDataService demoDataService;
    @Mock private MeetingRepository meetingRepository;
    @Mock private MeetingAttendeeRepository meetingAttendeeRepository;
    @Mock private MeetingAnalysisRepository meetingAnalysisRepository;
    @Mock private MeetingActionItemRepository meetingActionItemRepository;
    @Mock private TaskRepository taskRepository;
    @Mock private NotificationRepository notificationRepository;
    @Mock private NotificationService notificationService;
    @Mock private UserRepository userRepository;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private RagIngestService ragIngestService;
    @Mock private MeetingAnalysisPersistence meetingAnalysisPersistence;

    @BeforeEach
    void authenticateAsCurrentUser() {
        UserPrincipal principal = new UserPrincipal(CURRENT_USER_ID, "user@example.com", "김민준");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private MeetingAnalysisService newService() {
        return new MeetingAnalysisService(
            meetingAnalysisJobPublisher, demoDataService, meetingRepository, meetingAttendeeRepository,
            meetingAnalysisRepository, meetingActionItemRepository, taskRepository, notificationRepository,
            notificationService, userRepository, projectMemberRepository, projectRepository, ragIngestService,
            meetingAnalysisPersistence, "/tmp/workflow-uploads"
        );
    }

    private void mockMember(Long projectDbId) {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(projectDbId);
        when(projectMemberRepository.existsByProjectIdAndUserId(projectDbId, CURRENT_USER_ID)).thenReturn(true);
    }

    /** delete()가 서비스 레이어에서도 팀장 권한을 재확인하므로, 삭제 관련 테스트는 이 헬퍼로 팀장 멤버십까지 스텁한다. */
    private void mockLeader(Long projectDbId) {
        mockMember(projectDbId);
        when(projectMemberRepository.findByProjectIdAndUserId(projectDbId, CURRENT_USER_ID))
            .thenReturn(Optional.of(new ProjectMember(projectDbId, CURRENT_USER_ID, ProjectRole.LEADER)));
    }

    @Test
    void analyzeSavesMeetingAsProcessingAndReturnsImmediately() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());
        MeetingAnalysisResponse response = service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of("김민준"), null
        );

        assertThat(response.status()).isEqualTo("PROCESSING");
        assertThat(response.analysis()).isNull();
        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getAllValues().get(0).getAnalysisStatus()).isEqualTo("processing");
        assertThat(meetingCaptor.getAllValues().get(0).getAnalysisJobId()).isNotNull();
        verify(meetingAnalysisJobPublisher).enqueue(any(), any(AiAnalyzeRequest.class), any(UUID.class));
    }

    @Test
    void analyzeSavesExtractedTextAsTranscriptOnMeeting() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용 원문".getBytes());
        MeetingAnalysisResponse response = service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of(), null
        );

        assertThat(response.transcript()).isEqualTo("회의 내용 원문");
        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getValue().getTranscript()).isEqualTo("회의 내용 원문");
    }

    @Test
    void analyzeSetsUploadedByToCurrentUser() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.analyze(
            "demo-project", null, "회의", "2026-07-23", "정기회의", "document", List.of(), List.of()
        );

        ArgumentCaptor<Meeting> meetingCaptor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(meetingCaptor.capture());
        assertThat(meetingCaptor.getAllValues().get(0).getUploadedBy()).isEqualTo(CURRENT_USER_ID);
    }

    @Test
    void analyzeExtractsPdfTextBeforeDispatchingAnalysisRequest() throws Exception {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));

        MockMultipartFile file = new MockMultipartFile(
            "file",
            "minutes.pdf",
            "application/pdf",
            createPdfBytes("Meeting minutes body: Park Jisu checks retry flow.")
        );

        service.analyze(
            "demo-project", file, "PDF 회의록", "2026-07-20", "정기회의", "document", List.of("박지수"), null
        );

        ArgumentCaptor<AiAnalyzeRequest> requestCaptor = ArgumentCaptor.forClass(AiAnalyzeRequest.class);
        verify(meetingAnalysisJobPublisher).enqueue(any(), requestCaptor.capture(), any(UUID.class));
        assertThat(requestCaptor.getValue().text()).contains("Meeting minutes body");
        assertThat(requestCaptor.getValue().text()).doesNotContain("텍스트 추출 예정");
    }

    @Test
    void analyzeSkipsSynchronousExtractionForAudioAndEnqueuesWithBlankText() {
        // STT는 수 초~수십 초 걸릴 수 있어 업로드 요청 안에서 동기 처리하면 타임아웃 위험이 크므로,
        // analyze()는 오디오 파일의 텍스트 추출을 하지 않고 빈 텍스트로 큐에 넘긴다.
        // 실제 STT는 MeetingAnalysisRunner가 비동기 큐 실행 시점에 수행한다.
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        MockMultipartFile file = new MockMultipartFile("file", "meeting.wav", "audio/wav", "fake-audio-bytes".getBytes());

        MeetingAnalysisResponse response = service.analyze(
            "demo-project", file, "음성 회의록", "2026-07-24", "정기회의", "audio", List.of("김민준"), null
        );

        assertThat(response.transcript()).isEmpty();
        ArgumentCaptor<AiAnalyzeRequest> requestCaptor = ArgumentCaptor.forClass(AiAnalyzeRequest.class);
        verify(meetingAnalysisJobPublisher).enqueue(any(), requestCaptor.capture(), any(UUID.class));
        assertThat(requestCaptor.getValue().text()).isEmpty();
        assertThat(requestCaptor.getValue().source_type()).isEqualTo("audio");
    }

    @Test
    void analyzeNormalizesSourceTypeToAudioFromFileExtensionEvenWhenCallerOmitsIt() {
        // 프론트가 sourceType을 안 보내거나 기본값("document")으로 보내도, 파일 확장자가 오디오면
        // 큐(MeetingAnalysisRunner)가 source_type만 보고 STT 필요 여부를 판단하므로 반드시 "audio"로
        // 정규화돼야 한다. 안 그러면 빈 텍스트로 분석이 그대로 진행되는 버그가 생긴다.
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        MockMultipartFile file = new MockMultipartFile("file", "meeting.wav", "audio/wav", "fake-audio-bytes".getBytes());

        service.analyze(
            "demo-project", file, "음성 회의록", "2026-07-24", "정기회의", "document", List.of("김민준"), null
        );

        ArgumentCaptor<AiAnalyzeRequest> requestCaptor = ArgumentCaptor.forClass(AiAnalyzeRequest.class);
        verify(meetingAnalysisJobPublisher).enqueue(any(), requestCaptor.capture(), any(UUID.class));
        assertThat(requestCaptor.getValue().source_type()).isEqualTo("audio");
    }

    @Test
    void analyzeRejectsAudioFileExceedingSizeLimit() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        byte[] oversized = new byte[31 * 1024 * 1024];
        MockMultipartFile file = new MockMultipartFile("file", "meeting.wav", "audio/wav", oversized);

        assertThatThrownBy(() -> service.analyze(
            "demo-project", file, "음성 회의록", "2026-07-24", "정기회의", "audio", List.of("김민준"), null
        )).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void analyzeEnqueuesOnlyAfterTransactionCommitWhenSynchronizationIsActive() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> {
            Meeting meeting = invocation.getArgument(0);
            ReflectionTestUtils.setField(meeting, "id", 12L);
            return meeting;
        });
        TransactionSynchronizationManager.initSynchronization();

        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());
        service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of("김민준"), null
        );

        verify(meetingAnalysisJobPublisher, never()).enqueue(any(), any(), any());
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(meetingAnalysisJobPublisher).enqueue(eq(12L), any(AiAnalyzeRequest.class), any(UUID.class));
    }

    @Test
    void analyzeMarksMeetingFailedWhenImmediateEnqueueFails() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> {
            Meeting meeting = invocation.getArgument(0);
            ReflectionTestUtils.setField(meeting, "id", 13L);
            return meeting;
        });
        doThrow(new IllegalStateException("redis unavailable"))
            .when(meetingAnalysisJobPublisher).enqueue(any(), any(), any());

        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());
        service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of("김민준"), null
        );

        verify(meetingAnalysisPersistence).saveAnalysisFailureInNewTransaction(
            eq(13L),
            eq(MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE),
            any(UUID.class)
        );
    }

    @Test
    void analyzeMarksMeetingFailedWhenAfterCommitEnqueueFails() {
        mockMember(1L);
        MeetingAnalysisService service = newService();
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> {
            Meeting meeting = invocation.getArgument(0);
            ReflectionTestUtils.setField(meeting, "id", 14L);
            return meeting;
        });
        doThrow(new IllegalStateException("redis unavailable"))
            .when(meetingAnalysisJobPublisher).enqueue(any(), any(), any());
        TransactionSynchronizationManager.initSynchronization();

        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());
        service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of("김민준"), null
        );

        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(meetingAnalysisPersistence).saveAnalysisFailureInNewTransaction(
            eq(14L),
            eq(MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE),
            any(UUID.class)
        );
    }

    @Test
    void analyzeRejectsAttendeeThatIsNotProjectMember() {
        mockMember(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 99L)).thenReturn(false);
        MeetingAnalysisService service = newService();
        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());

        assertThatThrownBy(() -> service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of(), List.of(99L)
        )).isInstanceOf(IllegalArgumentException.class);

        verify(meetingRepository, never()).save(any());
    }

    @Test
    void analyzeSavesValidatedAttendeesAndIncludesThemInResponse() {
        mockMember(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 2L)).thenReturn(true);
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(invocation -> invocation.getArgument(0));
        User attendeeUser = mock(User.class);
        when(attendeeUser.getId()).thenReturn(2L);
        when(attendeeUser.getName()).thenReturn("이서연");
        when(userRepository.findAllById(List.of(2L))).thenReturn(List.of(attendeeUser));
        when(meetingAttendeeRepository.findByMeetingId(any())).thenReturn(List.of(new MeetingAttendee(null, 2L)));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(new ProjectMember(1L, 2L, ProjectRole.MEMBER)));

        MeetingAnalysisService service = newService();
        MockMultipartFile file = new MockMultipartFile("file", "notes.txt", "text/plain", "회의 내용".getBytes());
        MeetingAnalysisResponse response = service.analyze(
            "demo-project", file, "7차 정기회의", "2026-07-15", "정기회의", "document", List.of(), List.of(2L)
        );

        ArgumentCaptor<MeetingAttendee> attendeeCaptor = ArgumentCaptor.forClass(MeetingAttendee.class);
        verify(meetingAttendeeRepository).save(attendeeCaptor.capture());
        assertThat(attendeeCaptor.getValue().getUserId()).isEqualTo(2L);
        assertThat(response.attendees()).hasSize(1);
        assertThat(response.attendees().get(0).id()).isEqualTo(2L);
        assertThat(response.attendees().get(0).name()).isEqualTo("이서연");
        assertThat(response.attendees().get(0).role()).isEqualTo("팀원");
    }

    @Test
    void nonMemberIsDeniedAccessToProjectMeetings() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, CURRENT_USER_ID)).thenReturn(false);
        MeetingAnalysisService service = newService();

        assertThatThrownBy(() -> service.find("demo-project", "5")).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.findByProject("demo-project")).isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void findReturnsNullWhenMeetingBelongsToAnotherProject() {
        mockMember(1L);
        when(meetingRepository.findByIdAndProjectId(99L, 1L)).thenReturn(Optional.empty());
        MeetingAnalysisService service = newService();

        assertThat(service.find("demo-project", "99")).isNull();
    }

    @Test
    void findByProjectOnlyQueriesMeetingsScopedToThatProject() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "document", "/tmp/x.txt", "processing", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(meeting));
        MeetingAnalysisService service = newService();

        List<MeetingSummary> result = service.findByProject("demo-project");

        assertThat(result).hasSize(1);
        verify(meetingRepository).findByProjectIdOrderByCreatedAtDesc(1L);
    }

    @Test
    void findByProjectMarksTasksRegisteredTrueWhenAnActionItemHasBeenTurnedIntoATask() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "document", "/tmp/x.txt", "completed", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        ReflectionTestUtils.setField(meeting, "id", 10L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(meeting));

        MeetingActionItem registeredItem = new MeetingActionItem(10L, "할일", "설명", "BACKEND", null, 2L, null, "HIGH", "근거");
        registeredItem.setCreatedTaskId(99L);
        when(meetingActionItemRepository.findByMeetingIdIn(List.of(10L))).thenReturn(List.of(registeredItem));
        MeetingAnalysisService service = newService();

        List<MeetingSummary> result = service.findByProject("demo-project");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).tasksRegistered()).isTrue();
    }

    @Test
    void findByProjectMarksTasksRegisteredFalseWhenNoActionItemHasBeenTurnedIntoATask() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "document", "/tmp/x.txt", "completed", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        ReflectionTestUtils.setField(meeting, "id", 10L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(meeting));

        MeetingActionItem unregisteredItem = new MeetingActionItem(10L, "할일", "설명", "BACKEND", null, 2L, null, "HIGH", "근거");
        when(meetingActionItemRepository.findByMeetingIdIn(List.of(10L))).thenReturn(List.of(unregisteredItem));
        MeetingAnalysisService service = newService();

        List<MeetingSummary> result = service.findByProject("demo-project");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).tasksRegistered()).isFalse();
    }

    @Test
    void deleteRejectsWhenCurrentUserIsNotLeader() {
        // 컨트롤러의 @PreAuthorize에만 기대지 않고 서비스 레이어에서도 팀장 권한을 재확인한다.
        // 존재하지 않는 회의록에 대해 403을 먼저 주지 않도록, 권한 검사 전에 회의록 존재를 확인하므로
        // 이 테스트는 실제로 존재하는 회의록을 스텁해야 팀장 권한 검사 분기까지 도달한다.
        mockMember(1L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, CURRENT_USER_ID))
            .thenReturn(Optional.of(new ProjectMember(1L, CURRENT_USER_ID, ProjectRole.MEMBER)));
        Meeting meeting = new Meeting(1L, "회의록", "text/plain", null, "completed", null, null, null, 50L, null);
        when(meetingRepository.findByIdAndProjectIdForUpdate(20L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        assertThatThrownBy(() -> service.delete("demo-project", "20", false))
            .isInstanceOf(AccessDeniedException.class);

        verify(meetingRepository, never()).delete(any());
    }

    @Test
    void deleteReturnsNullWhenMeetingBelongsToAnotherProject() {
        // 회의록이 존재하지 않으면(다른 프로젝트 소속) 팀장 권한 검사에 도달하지 않으므로 mockMember로 충분하다.
        mockMember(1L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(99L, 1L)).thenReturn(Optional.empty());
        MeetingAnalysisService service = newService();

        assertThat(service.delete("demo-project", "99", false)).isNull();

        verify(meetingRepository, never()).delete(any());
        verify(meetingAttendeeRepository, never()).deleteByMeetingId(any());
        verify(meetingActionItemRepository, never()).deleteByMeetingId(any());
        verify(meetingActionItemRepository, never()).clearMeetingId(any());
        verify(meetingAnalysisRepository, never()).deleteById(any());
        verify(taskRepository, never()).clearSourceMeetingId(any());
        verify(taskRepository, never()).deleteBySourceMeetingId(any());
    }

    @Test
    void deleteRemovesMeetingRelatedRowsAndUploadedFile() throws Exception {
        mockLeader(1L);
        Path dir = Files.createTempDirectory("meeting-delete");
        Path file = dir.resolve("notes.txt");
        Files.writeString(file, "삭제할 회의록");
        Meeting meeting = new Meeting(1L, "삭제 회의", "document", file.toString(), "completed", LocalDate.now(), "정기회의", "notes.txt", CURRENT_USER_ID, 5L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(8L, 1L)).thenReturn(Optional.of(meeting));
        when(meetingAnalysisRepository.existsById(8L)).thenReturn(true);
        MeetingAnalysisService service = newService();

        MeetingDeleteResponse response = service.delete("demo-project", "8", false);

        assertThat(response.meetingId()).isEqualTo("8");
        assertThat(response.status()).isEqualTo("DELETED");
        verify(meetingActionItemRepository, never()).deleteByMeetingId(any());
        verify(meetingActionItemRepository).clearMeetingId(8L);
        verify(meetingAttendeeRepository).deleteByMeetingId(8L);
        verify(taskRepository).clearSourceMeetingId(8L);
        verify(taskRepository, never()).deleteBySourceMeetingId(any());
        verify(meetingAnalysisRepository).deleteById(8L);
        verify(meetingRepository).delete(meeting);
        verify(ragIngestService).recordDeleteSourceIntent(1L, "meeting", 8L);
        verify(ragIngestService).deleteSourceBestEffort(1L, "meeting", 8L);
        assertThat(Files.exists(file)).isFalse();
        Files.deleteIfExists(dir);
    }

    @Test
    void deleteNotifiesActorAndUploaderWhenLeaderDeletesSomeoneElsesMeeting() {
        // 삭제는 팀장 전용이라 actor(CurrentUser)는 항상 팀장이다. 반대편은 팀장 자신이 아니라
        // 실제 업로더(50L)여야, 팀장이 남이 올린 회의록을 지웠을 때 업로더에게도 알림이 간다.
        mockLeader(1L);
        Long uploaderId = 50L;
        Meeting meeting = new Meeting(1L, "삭제 회의", "document", null, "completed", LocalDate.now(), "정기회의", "notes.txt", uploaderId, 5L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(12L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        service.delete("demo-project", "12", false);

        verify(notificationService).notifyActorAndCounterpart(
            eq(CURRENT_USER_ID), eq("MEETING_DELETED"), any(), any(),
            eq(uploaderId), eq("MEETING_DELETED"), any(), any(),
            eq("meeting"), eq(12L)
        );
    }

    @Test
    void deleteSucceedsWhenCurrentUserIsNotTheUploader() {
        // 팀장은 본인이 업로드하지 않은 회의록도 삭제할 수 있다 — 업로더 일치 여부는 더 이상
        // 서비스 레이어에서 검사하지 않고, 팀장 권한 자체는 컨트롤러의 @PreAuthorize가 강제한다.
        mockLeader(1L);
        Long otherUploaderId = 999L;
        Meeting meeting = new Meeting(1L, "삭제 회의", "document", "/tmp/x.txt", "completed", LocalDate.now(), "정기회의", "notes.txt", otherUploaderId, 5L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(10L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingDeleteResponse response = service.delete("demo-project", "10", false);

        assertThat(response.status()).isEqualTo("DELETED");
        verify(meetingRepository).delete(meeting);
    }

    @Test
    void deleteSucceedsWhenMeetingHasNoRecordedUploader() {
        mockLeader(1L);
        Meeting meeting = new Meeting(1L, "삭제 회의", "document", "/tmp/x.txt", "completed", LocalDate.now(), "정기회의", "notes.txt", null, 5L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(11L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingDeleteResponse response = service.delete("demo-project", "11", false);

        assertThat(response.status()).isEqualTo("DELETED");
        verify(meetingRepository).delete(meeting);
    }

    @Test
    void deleteCanRemoveLinkedBoardTasksWhenRequested() {
        mockLeader(1L);
        Meeting meeting = new Meeting(1L, "삭제 회의", "document", null, "completed", LocalDate.now(), "정기회의", "notes.txt", CURRENT_USER_ID, 5L);
        com.workflowai.task.Task linkedTask = new com.workflowai.task.Task(
            1L, "연결 업무", "other", "todo", null, null, null, null, "MEETING_AI", 9L, 1L, 0.0
        );
        ReflectionTestUtils.setField(linkedTask, "id", 77L);
        MeetingActionItem linkedActionItem = new MeetingActionItem(
            9L, "후속 조치", null, "other", null, null, null, null, null
        );
        ReflectionTestUtils.setField(linkedActionItem, "id", 88L);
        when(meetingRepository.findByIdAndProjectIdForUpdate(9L, 1L)).thenReturn(Optional.of(meeting));
        when(taskRepository.findBySourceMeetingId(9L)).thenReturn(List.of(linkedTask));
        when(meetingActionItemRepository.findByMeetingId(9L)).thenReturn(List.of(linkedActionItem));
        MeetingAnalysisService service = newService();

        MeetingDeleteResponse response = service.delete("demo-project", "9", true);

        assertThat(response.status()).isEqualTo("DELETED");
        org.mockito.InOrder inOrder = org.mockito.Mockito.inOrder(meetingActionItemRepository, taskRepository, meetingRepository);
        inOrder.verify(meetingActionItemRepository).deleteByMeetingId(9L);
        inOrder.verify(taskRepository).deleteBySourceMeetingId(9L);
        inOrder.verify(meetingRepository).delete(meeting);
        verify(taskRepository).deleteBySourceMeetingId(9L);
        verify(taskRepository, never()).clearSourceMeetingId(any());
        verify(meetingActionItemRepository, never()).clearMeetingId(any());
        verify(meetingRepository).delete(meeting);
        verify(ragIngestService).recordDeleteSourceIntent(1L, "meeting", 9L);
        verify(ragIngestService).recordDeleteSourceIntent(1L, "task", 77L);
        verify(ragIngestService).recordDeleteSourceIntent(1L, "action_item", 88L);
        verify(ragIngestService).deleteSourceBestEffort(1L, "task", 77L);
        verify(ragIngestService).deleteSourceBestEffort(1L, "action_item", 88L);
    }

    @Test
    void retryRejectsMeetingThatIsNotFailed() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "document", "/tmp/x.txt", "processing", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        when(meetingRepository.findByIdAndProjectId(3L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        assertThatThrownBy(() -> service.retry("demo-project", "3")).isInstanceOf(IllegalStateException.class);
        verify(meetingAnalysisJobPublisher, never()).enqueue(any(), any(), any());
    }

    @Test
    void findUsesConsistentProjectIdAndFileTypeForProcessingAndCompletedResponses() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "audio", "/tmp/x.mp3", "processing", LocalDate.now(), "정기회의", "x.mp3", null, 5L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingAnalysisResponse processing = service.find("demo-project", "5");

        assertThat(processing.projectId()).isEqualTo("demo-project");
        assertThat(processing.sourceType()).isEqualTo("audio");
        assertThat(processing.status()).isEqualTo("PROCESSING");

        meeting.setAnalysisStatus("completed");
        when(meetingAnalysisRepository.findById(5L)).thenReturn(Optional.of(new MeetingAnalysis(
            5L, "요약", List.of("결정"), List.of("위험"), List.of("키워드"), "FASTAPI"
        )));
        when(meetingActionItemRepository.findByMeetingId(5L)).thenReturn(List.of());

        MeetingAnalysisResponse completed = service.find("demo-project", "5");

        assertThat(completed.projectId()).isEqualTo("demo-project");
        assertThat(completed.sourceType()).isEqualTo("audio");
        assertThat(completed.status()).isEqualTo("COMPLETED");
    }

    @Test
    void findIncludesTranscriptForProcessingAndCompletedResponses() {
        mockMember(1L);
        Meeting meeting = new Meeting(1L, "정기회의", "document", "/tmp/x.txt", "pending", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        ReflectionTestUtils.setField(meeting, "transcript", "수정된 회의록 원문");
        when(meetingRepository.findByIdAndProjectId(7L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingAnalysisResponse processing = service.find("demo-project", "7");
        assertThat(processing.transcript()).isEqualTo("수정된 회의록 원문");

        meeting.setAnalysisStatus("completed");
        when(meetingAnalysisRepository.findById(7L)).thenReturn(Optional.of(new MeetingAnalysis(
            7L, "요약", List.of("결정"), List.of("위험"), List.of("키워드"), "FASTAPI"
        )));
        when(meetingActionItemRepository.findByMeetingId(7L)).thenReturn(List.of());

        MeetingAnalysisResponse completed = service.find("demo-project", "7");
        assertThat(completed.transcript()).isEqualTo("수정된 회의록 원문");
    }

    @Test
    void retryTransitionsFailedMeetingBackToProcessing() throws Exception {
        mockMember(1L);
        Path textFile = Files.createTempFile("meeting-notes", ".txt");
        Files.writeString(textFile, "재분석할 회의 내용");
        Meeting meeting = new Meeting(1L, "정기회의", "document", textFile.toString(), "failed", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        when(meetingRepository.findByIdAndProjectId(4L, 1L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(4L)).thenReturn(List.of());
        MeetingAnalysisService service = newService();

        MeetingAnalysisResponse response = service.retry("demo-project", "4");

        assertThat(response.status()).isEqualTo("PROCESSING");
        assertThat(meeting.getAnalysisStatus()).isEqualTo("processing");
        assertThat(meeting.getTranscript()).isEqualTo("재분석할 회의 내용");
        verify(meetingAnalysisJobPublisher).enqueue(eq(4L), eq(new AiAnalyzeRequest(
            "demo-project", "정기회의", meeting.getMeetingDate().toString(), "정기회의", "document", "x.txt", "재분석할 회의 내용", List.of()
        )), eq(meeting.getAnalysisJobId()));
        Files.deleteIfExists(textFile);
    }

    @Test
    void retryMarksMeetingFailedWhenEnqueueFails() throws Exception {
        mockMember(1L);
        Path textFile = Files.createTempFile("meeting-notes", ".txt");
        Files.writeString(textFile, "재분석할 회의 내용");
        Meeting meeting = new Meeting(1L, "정기회의", "document", textFile.toString(), "failed", LocalDate.now(), "정기회의", "x.txt", null, 5L);
        when(meetingRepository.findByIdAndProjectId(8L, 1L)).thenReturn(Optional.of(meeting));
        when(meetingAttendeeRepository.findByMeetingId(8L)).thenReturn(List.of());
        doThrow(new IllegalStateException("redis unavailable"))
            .when(meetingAnalysisJobPublisher).enqueue(any(), any(), any());
        MeetingAnalysisService service = newService();

        service.retry("demo-project", "8");

        verify(meetingAnalysisPersistence).saveAnalysisFailureInNewTransaction(
            eq(8L),
            eq(MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE),
            eq(meeting.getAnalysisJobId())
        );
        Files.deleteIfExists(textFile);
    }

    @Test
    void retryFailsWithClearMessageWhenStoredFileIsNotTextExtractable() throws Exception {
        mockMember(1L);
        Path audioFile = Files.createTempFile("meeting-audio", ".mp3");
        Files.write(audioFile, new byte[] { 0, 1, 2, 3 });
        Meeting meeting = new Meeting(
            1L, "정기회의", "audio", audioFile.toString(), "failed", LocalDate.now(), "정기회의", "recording.mp3", null, 5L
        );
        when(meetingRepository.findByIdAndProjectId(6L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingAnalysisResponse response = service.retry("demo-project", "6");

        assertThat(response.status()).isEqualTo("FAILED");
        assertThat(response.errorMessage()).isEqualTo(MeetingAnalysisPersistence.REUPLOAD_REQUIRED_ERROR_MESSAGE);
        verify(meetingAnalysisPersistence).saveAnalysisFailure(6L, MeetingAnalysisPersistence.REUPLOAD_REQUIRED_ERROR_MESSAGE);
        verify(meetingAnalysisRepository, never()).save(any());
        verify(meetingAnalysisJobPublisher, never()).enqueue(any(), any(), any());
        Files.deleteIfExists(audioFile);
    }

    @Test
    void retryFailsWithClearMessageWhenStoredFileIsEmpty() throws Exception {
        mockMember(1L);
        Path emptyFile = Files.createTempFile("meeting-empty", ".txt");
        Meeting meeting = new Meeting(
            1L, "정기회의", "document", emptyFile.toString(), "failed", LocalDate.now(), "정기회의", "empty.txt", null, 5L
        );
        when(meetingRepository.findByIdAndProjectId(7L, 1L)).thenReturn(Optional.of(meeting));
        MeetingAnalysisService service = newService();

        MeetingAnalysisResponse response = service.retry("demo-project", "7");

        assertThat(response.status()).isEqualTo("FAILED");
        assertThat(response.errorMessage()).isEqualTo(MeetingAnalysisPersistence.REUPLOAD_READ_ERROR_MESSAGE);
        verify(meetingAnalysisPersistence).saveAnalysisFailure(7L, MeetingAnalysisPersistence.REUPLOAD_READ_ERROR_MESSAGE);
        verify(meetingAnalysisRepository, never()).save(any());
        verify(meetingAnalysisJobPublisher, never()).enqueue(any(), any(), any());
        Files.deleteIfExists(emptyFile);
    }

    @Test
    void attendanceSummaryComputesAttendedCountAndRatePerMember() {
        mockMember(1L);
        Meeting meetingOne = new Meeting(1L, "1차 회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", null, 1L);
        Meeting meetingTwo = new Meeting(1L, "2차 회의", "document", null, "completed", LocalDate.now(), "정기회의", "b.txt", null, 1L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(meetingOne, meetingTwo));
        when(meetingAttendeeRepository.findByMeetingIdIn(any())).thenReturn(List.of(
            new MeetingAttendee(null, 2L),
            new MeetingAttendee(null, 2L)
        ));
        User attendeeUser = mock(User.class);
        when(attendeeUser.getId()).thenReturn(2L);
        when(attendeeUser.getName()).thenReturn("이서연");
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(new ProjectMember(1L, 2L, ProjectRole.MEMBER)));
        when(userRepository.findAllById(List.of(2L))).thenReturn(List.of(attendeeUser));
        MeetingAnalysisService service = newService();

        List<MeetingAttendanceSummary> summary = service.attendanceSummary("demo-project");

        assertThat(summary).hasSize(1);
        assertThat(summary.get(0).userId()).isEqualTo(2L);
        assertThat(summary.get(0).meetingsAttended()).isEqualTo(2);
        assertThat(summary.get(0).totalMeetings()).isEqualTo(2);
        assertThat(summary.get(0).attendanceRate()).isEqualTo(100);
    }

    @Test
    void attendanceDetailMarksAttendedAndAbsentMeetingsSortedByDate() {
        mockMember(1L);
        Meeting laterMeeting = new Meeting(1L, "12.11 스프린트 리뷰", "document", null, "completed", LocalDate.of(2026, 12, 11), "정기회의", "b.txt", null, 1L);
        Meeting earlierMeeting = new Meeting(1L, "12.10 팀 정기 회의", "document", null, "completed", LocalDate.of(2026, 12, 10), "정기회의", "a.txt", null, 1L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(laterMeeting, earlierMeeting));
        when(meetingAttendeeRepository.findByMeetingIdIn(any())).thenReturn(List.of(
            new MeetingAttendee(null, 2L)
        ));
        MeetingAnalysisService service = newService();

        List<MeetingAttendanceDetail> detail = service.attendanceDetail("demo-project", 2L);

        assertThat(detail).hasSize(2);
        assertThat(detail.get(0).title()).isEqualTo("12.10 팀 정기 회의");
        assertThat(detail.get(0).attended()).isFalse();
        assertThat(detail.get(1).title()).isEqualTo("12.11 스프린트 리뷰");
        assertThat(detail.get(1).attended()).isFalse();
    }

    @Test
    void attendanceDetailMarksAttendedMeetingAsAttended() {
        mockMember(1L);
        Long attendedMeetingId = 50L;

        Meeting attendedMeeting = new Meeting(1L, "12.10 참석한 회의", "document", null, "completed", LocalDate.of(2026, 12, 10), "정기회의", "a.txt", null, 1L);
        ReflectionTestUtils.setField(attendedMeeting, "id", attendedMeetingId);

        Meeting absentMeeting = new Meeting(1L, "12.11 미참석 회의", "document", null, "completed", LocalDate.of(2026, 12, 11), "정기회의", "b.txt", null, 1L);

        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(absentMeeting, attendedMeeting));

        MeetingAttendee attendee = new MeetingAttendee(null, 2L);
        ReflectionTestUtils.setField(attendee, "meetingId", attendedMeetingId);

        when(meetingAttendeeRepository.findByMeetingIdIn(any())).thenReturn(List.of(attendee));

        MeetingAnalysisService service = newService();

        List<MeetingAttendanceDetail> detail = service.attendanceDetail("demo-project", 2L);

        assertThat(detail).hasSize(2);
        assertThat(detail.get(0).title()).isEqualTo("12.10 참석한 회의");
        assertThat(detail.get(0).attended()).isTrue();
        assertThat(detail.get(1).title()).isEqualTo("12.11 미참석 회의");
        assertThat(detail.get(1).attended()).isFalse();
    }

    @Test
    void attendanceDetailReturnsEmptyListWhenNoMeetings() {
        mockMember(1L);
        when(meetingRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        MeetingAnalysisService service = newService();

        List<MeetingAttendanceDetail> detail = service.attendanceDetail("demo-project", 2L);

        assertThat(detail).isEmpty();
    }

    @Test
    void registerTasksUsesCurrentUserAsCreatedByNotHardcodedDemoUser() {
        UserPrincipal otherLeader = new UserPrincipal(25L, "leader@example.com", "박지수");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(otherLeader, null, List.of())
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 25L)).thenReturn(true);
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(meeting));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(any(), any())).thenReturn(Optional.empty());
        MeetingAnalysisService service = newService();

        TaskRegisterRequest request = new TaskRegisterRequest(List.of(
            new MeetingTodo("업무1", "설명", null, null, null, "MEDIUM", "ETC", true, "")
        ));
        service.registerTasks("demo-project", "5", request);

        ArgumentCaptor<Task> captor = ArgumentCaptor.forClass(Task.class);
        verify(taskRepository).save(captor.capture());
        assertThat(captor.getValue().getCreatedBy()).isEqualTo(25L);
    }

    @Test
    void registerTasksNotifiesLeaderAndUploaderWhenDifferent() {
        UserPrincipal leader = new UserPrincipal(99L, "leader@example.com", "김팀장");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(leader, null, List.of())
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 99L)).thenReturn(true);
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(meeting));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(any(), any())).thenReturn(Optional.empty());
        MeetingAnalysisService service = newService();

        TaskRegisterRequest request = new TaskRegisterRequest(List.of(
            new MeetingTodo("업무1", "설명", null, null, null, "MEDIUM", "ETC", true, "")
        ));
        service.registerTasks("demo-project", "5", request);

        verify(notificationService).notifyActorAndCounterpart(
            eq(99L), eq("MEETING_TASKS_REGISTERED"), any(), any(),
            eq(10L), eq("MEETING_TASKS_REGISTERED_NOTIFY_MEMBER"), any(), any(),
            eq("meeting"), eq(5L)
        );
    }

    @Test
    void confirmSaveMarksSavedAtWithoutSendingASeparateNotification() {
        // 저장 확정 알림은 보내지 않는다 - 분석 완료 시(MeetingAnalysisPersistence)
        // 이미 MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER로 알림이 간 상태라 중복 알림을 막는다.
        UserPrincipal uploader = new UserPrincipal(10L, "uploader@example.com", "박지수");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(uploader, null, List.of())
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(meeting));
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        MeetingAnalysisService service = newService();

        MeetingSaveResponse response = service.confirmSave("demo-project", "5");

        assertThat(response.status()).isEqualTo("SAVED");
        assertThat(meeting.getSavedAt()).isNotNull();
        verify(notificationService, never()).notifyActorAndCounterpart(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void createVersionRejectsNullRequest() {
        MeetingAnalysisService service = newService();

        assertThatThrownBy(() -> service.createVersion("demo-project", "5", null))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void createVersionRejectsBlankTranscript() {
        MeetingAnalysisService service = newService();

        assertThatThrownBy(() -> service.createVersion("demo-project", "5", new MeetingVersionRequest("   ", false)))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void createVersionSavesOnlyWhenTriggerAnalysisIsFalse() {
        UserPrincipal editor = new UserPrincipal(10L, "editor@example.com", "박지수");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(editor, null, List.of())
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        Meeting original = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(original, "id", 5L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(original));
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(original));
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectMemberRepository.findByProjectIdAndRole(1L, ProjectRole.LEADER))
            .thenReturn(Optional.of(new ProjectMember(1L, 99L, ProjectRole.LEADER)));
        MeetingAnalysisService service = newService();

        MeetingVersionResponse response = service.createVersion("demo-project", "5",
            new MeetingVersionRequest("수정된 본문", false));

        assertThat(response.status()).isEqualTo("SAVED");
        ArgumentCaptor<Meeting> captor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(captor.capture());
        Meeting savedVersion = captor.getAllValues().stream()
            .filter(m -> m.getOriginalMeetingId() != null).findFirst().orElseThrow();
        assertThat(savedVersion.getTitle()).isEqualTo("정기회의_수정본");
        assertThat(savedVersion.getAnalysisStatus()).isEqualTo("pending");
        verify(meetingAnalysisJobPublisher, never()).enqueue(any(), any(), any());
    }

    @Test
    void createVersionSecondEditGetsIncrementedSuffix() {
        mockMember(1L);
        Meeting original = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(original, "id", 5L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(original));
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(original));
        when(meetingRepository.existsByOriginalMeetingIdAndTitle(5L, "정기회의_수정본")).thenReturn(true);
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        MeetingAnalysisService service = newService();

        service.createVersion("demo-project", "5", new MeetingVersionRequest("본문", false));

        ArgumentCaptor<Meeting> captor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(captor.capture());
        Meeting savedVersion = captor.getAllValues().stream()
            .filter(m -> m.getOriginalMeetingId() != null).findFirst().orElseThrow();
        assertThat(savedVersion.getTitle()).isEqualTo("정기회의_수정본2");
    }

    @Test
    void createVersionSkipsExistingTitleWhenGapExistsFromDeletedVersion() {
        // "_수정본"이 삭제되고 "_수정본2"만 남은 상황(과거 count 기반이면 count=1이라 "_수정본2"를
        // 다시 생성해 유니크 인덱스와 충돌한다). 존재 확인 루프는 실제로 비어 있는 "_수정본" 자리를 찾아낸다.
        mockMember(1L);
        Meeting original = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(original, "id", 5L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(original));
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(original));
        when(meetingRepository.existsByOriginalMeetingIdAndTitle(5L, "정기회의_수정본")).thenReturn(false);
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        MeetingAnalysisService service = newService();

        service.createVersion("demo-project", "5", new MeetingVersionRequest("본문", false));

        verify(meetingRepository, never()).existsByOriginalMeetingIdAndTitle(5L, "정기회의_수정본2");
        ArgumentCaptor<Meeting> captor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(captor.capture());
        Meeting savedVersion = captor.getAllValues().stream()
            .filter(m -> m.getOriginalMeetingId() != null).findFirst().orElseThrow();
        assertThat(savedVersion.getTitle()).isEqualTo("정기회의_수정본");
    }

    @Test
    void createVersionOnAlreadyVersionedMeetingUsesRootTitleAndRootCount() {
        mockMember(1L);
        // 최초 원본 A(id=5)
        Meeting rootOriginal = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(rootOriginal, "id", 5L);
        // "저장된 회의록" 탭에서 다시 연 이미 존재하는 버전 B(id=6, originalMeetingId=5) - 경로 파라미터로 들어옴
        Meeting pathMeeting = new Meeting(1L, "정기회의_수정본", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(pathMeeting, "id", 6L);
        ReflectionTestUtils.setField(pathMeeting, "originalMeetingId", 5L);

        when(meetingRepository.findByIdAndProjectId(6L, 1L)).thenReturn(Optional.of(pathMeeting));
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(rootOriginal));
        when(meetingRepository.existsByOriginalMeetingIdAndTitle(5L, "정기회의_수정본")).thenReturn(true);
        when(meetingRepository.existsByOriginalMeetingIdAndTitle(5L, "정기회의_수정본2")).thenReturn(true);
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        MeetingAnalysisService service = newService();

        service.createVersion("demo-project", "6", new MeetingVersionRequest("본문", false));

        verify(meetingRepository, atLeastOnce()).existsByOriginalMeetingIdAndTitle(eq(5L), any());
        verify(meetingRepository, never()).existsByOriginalMeetingIdAndTitle(eq(6L), any());
        ArgumentCaptor<Meeting> captor = ArgumentCaptor.forClass(Meeting.class);
        verify(meetingRepository, atLeastOnce()).save(captor.capture());
        Meeting savedVersion = captor.getAllValues().stream()
            .filter(m -> m.getOriginalMeetingId() != null).findFirst().orElseThrow();
        // 최초 원본(A) 제목 기준 "_수정본3" - "정기회의_수정본_수정본" 처럼 중첩되면 안 됨
        assertThat(savedVersion.getTitle()).isEqualTo("정기회의_수정본3");
    }

    @Test
    void createVersionTriggersAnalysisWhenRequested() {
        mockMember(1L);
        Meeting original = new Meeting(1L, "정기회의", "document", null, "completed", LocalDate.now(), "정기회의", "a.txt", 10L, 10L);
        ReflectionTestUtils.setField(original, "id", 5L);
        when(meetingRepository.findByIdAndProjectId(5L, 1L)).thenReturn(Optional.of(original));
        when(meetingRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(original));
        when(meetingRepository.save(any(Meeting.class))).thenAnswer(inv -> inv.getArgument(0));
        MeetingAnalysisService service = newService();

        MeetingVersionResponse response = service.createVersion("demo-project", "5",
            new MeetingVersionRequest("수정된 본문", true));

        assertThat(response.status()).isEqualTo("PROCESSING");
        verify(meetingAnalysisJobPublisher).enqueue(any(), any(), any());
    }

    private byte[] createPdfBytes(String text) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.beginText();
                content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(50, 700);
                content.showText(text);
                content.endText();
            }
            document.save(output);
            return output.toByteArray();
        }
    }
}
