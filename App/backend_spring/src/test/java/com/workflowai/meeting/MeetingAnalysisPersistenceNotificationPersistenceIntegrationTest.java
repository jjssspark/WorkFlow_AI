package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationAsyncSender;
import com.workflowai.notification.NotificationBroadcaster;
import com.workflowai.notification.NotificationRepository;
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
 * PR 리뷰에서 지적된 문제: afterCommit() 콜백은 원래 트랜잭션의 자원이 스레드에서
 * 완전히 언바인딩되기 전에 실행되므로, 그 안에서 NotificationService.notify()가
 * 기본 전파(REQUIRED)로 저장하면 이미 커밋 처리 중인 트랜잭션에 잘못 합류해 실제로는
 * 커밋되지 않을 수 있다는 우려였다.
 *
 * MeetingAnalysisPersistence는 이제 알림 저장을 REQUIRES_NEW 트랜잭션으로 격리한다.
 * 이 테스트는 NotificationService/NotificationRepository를 목이 아닌 실제 빈으로 띄워,
 * afterCommit 경로를 거쳐 나간 알림이 실제로 DB에 영속됐는지를 직접 조회로 증명한다.
 */
@DataJpaTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({MeetingAnalysisPersistence.class, NotificationService.class, NotificationAsyncSender.class})
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class MeetingAnalysisPersistenceNotificationPersistenceIntegrationTest {

    @Autowired
    private MeetingAnalysisPersistence persistence;

    @Autowired
    private MeetingRepository meetingRepository;

    @Autowired
    private NotificationRepository notificationRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockBean
    private RagIngestService ragIngestService;

    @MockBean
    private DemoDataService demoDataService;

    @MockBean
    private NotificationBroadcaster notificationBroadcaster;

    private Long saveTestMeeting() {
        Meeting meeting = new Meeting(1L, "정기회의", "document", null, "processing", LocalDate.now(), "정기회의", "a.txt", 10L, null);
        return meetingRepository.save(meeting).getId();
    }

    /**
     * 분석을 실행한 본인(업로더 10L)에게는 알림이 가지 않으므로, 알림이 실제로 발생하려면
     * 본인과 다른 팀장이 있어야 한다. 클래스가 NOT_SUPPORTED라 테스트 간 데이터가 남으므로
     * 중복 저장을 피한다.
     */
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
    void notificationRowIsDurablyPersistedAfterRealTransactionCommit() {
        saveTeamLeaderOnce();
        Long meetingId = saveTestMeeting();

        persistence.saveAnalysisSuccess(meetingId, emptyResult(), "FASTAPI");

        // 새 트랜잭션에서 다시 조회해, afterCommit 경로에서 저장한 알림이 실제로
        // 커밋된 것인지(같은 스레드의 미커밋 상태를 우연히 보는 게 아닌지) 확인한다.
        List<com.workflowai.notification.Notification> notifications =
            new TransactionTemplate(transactionManager).execute(status ->
                notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(99L, 1L));

        assertThat(notifications).hasSize(1);
        assertThat(notifications.get(0).getType()).isEqualTo("MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER");
        // 분석을 실행한 본인(10L)에게는 알림이 남지 않는다.
        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(10L, 1L)).isEmpty();
    }

    @Test
    void notificationRowIsNotPersistedWhenMainTransactionRollsBack() {
        saveTeamLeaderOnce();
        Long meetingId = saveTestMeeting();

        new TransactionTemplate(transactionManager).execute(status -> {
            persistence.saveAnalysisSuccess(meetingId, emptyResult(), "FASTAPI");
            status.setRollbackOnly();
            return null;
        });

        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(99L, 1L)).isEmpty();
    }
}
