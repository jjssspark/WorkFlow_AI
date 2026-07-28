package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.rag.RagIngestService;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MeetingAnalysisPersistenceTest는 TransactionSynchronizationManager를 수동으로 조작해
 * afterCommit 분기의 로직만 검증한다. 이 테스트는 실제 Spring 트랜잭션 프록시(@Transactional)와
 * H2 임베디드 DB를 사용해, 진짜 커밋/롤백 시점에 알림이 올바르게 나가고 미뤄지는지,
 * 그리고 롤백 시 DB 상태도 함께 되돌아가는지를 통합적으로 검증한다.
 *
 * @DataJpaTest는 기본적으로 테스트 메서드 전체를 트랜잭션으로 감싸고 끝에 롤백하는데,
 * 그러면 saveAnalysisSuccess/Failure의 @Transactional이 그 트랜잭션에 합류해 버려
 * afterCommit이 영영 발생하지 않는다. 클래스 레벨에서 Propagation.NOT_SUPPORTED로
 * 재선언해 그 기본 동작을 끄고, saveAnalysisSuccess/Failure 자신의 @Transactional이
 * 실제로 새 물리 트랜잭션을 열고 커밋하도록 한다.
 */
@DataJpaTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import(MeetingAnalysisPersistence.class)
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class MeetingAnalysisPersistenceRealTransactionIntegrationTest {

    @Autowired
    private MeetingAnalysisPersistence persistence;

    @Autowired
    private MeetingRepository meetingRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @MockBean
    private NotificationService notificationService;

    @MockBean
    private RagIngestService ragIngestService;

    @MockBean
    private DemoDataService demoDataService;

    private Long saveTestMeeting() {
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        return meetingRepository.save(meeting).getId();
    }

    /** 업로더 본인(10L)에게는 알림이 가지 않으므로, 알림 발생을 보려면 다른 사용자인 팀장이 필요하다. */
    private void saveTeamLeaderOnce() {
        if (!projectMemberRepository.existsByProjectIdAndUserId(1L, 99L)) {
            projectMemberRepository.save(new ProjectMember(1L, 99L, ProjectRole.LEADER));
        }
    }

    private MeetingAnalysisResult emptyResult() {
        return new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(),
            new MeetingMeta("정기회의", "2026-07-15", List.of())
        );
    }

    @Test
    void realTransactionCommitSendsSuccessNotificationAndPersistsCompletedStatus() {
        saveTeamLeaderOnce();
        Long meetingId = saveTestMeeting();

        persistence.saveAnalysisSuccess(meetingId, emptyResult(), "FASTAPI");

        verify(notificationService).notifyAfterCommit(
            eq(99L), eq("MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER"), any(), any(),
            eq("meeting"), eq(meetingId), eq(1L)
        );
        assertThat(meetingRepository.findById(meetingId).orElseThrow().getAnalysisStatus()).isEqualTo("completed");
    }

    @Test
    void realTransactionRollbackNeverSendsSuccessNotificationAndKeepsOriginalStatus() {
        saveTeamLeaderOnce();
        Long meetingId = saveTestMeeting();

        new TransactionTemplate(transactionManager).execute(status -> {
            persistence.saveAnalysisSuccess(meetingId, emptyResult(), "FASTAPI");
            status.setRollbackOnly();
            return null;
        });

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
        verify(ragIngestService, never()).ingestBestEffort(any(), any(), any(), any());
        verify(ragIngestService, never()).ingestBestEffort(any(), any(), any(), any(), any());
        assertThat(meetingRepository.findById(meetingId).orElseThrow().getAnalysisStatus()).isEqualTo("processing");
    }

    @Test
    void realTransactionCommitSendsFailureNotificationAndPersistsFailedStatus() {
        Long meetingId = saveTestMeeting();

        persistence.saveAnalysisFailure(meetingId, "FastAPI 연결 실패");

        verify(notificationService).notifyAfterCommit(
            10L, "MEETING_ANALYSIS_FAILED", "회의 분석에 실패했습니다.",
            "'정기회의' 회의록 분석에 실패했습니다. 다시 시도해주세요.", "meeting", meetingId, 1L
        );
        assertThat(meetingRepository.findById(meetingId).orElseThrow().getAnalysisStatus()).isEqualTo("failed");
    }

    @Test
    void realTransactionRollbackNeverSendsFailureNotificationAndKeepsOriginalStatus() {
        Long meetingId = saveTestMeeting();

        new TransactionTemplate(transactionManager).execute(status -> {
            persistence.saveAnalysisFailure(meetingId, "FastAPI 연결 실패");
            status.setRollbackOnly();
            return null;
        });

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
        assertThat(meetingRepository.findById(meetingId).orElseThrow().getAnalysisStatus()).isEqualTo("processing");
    }
}
