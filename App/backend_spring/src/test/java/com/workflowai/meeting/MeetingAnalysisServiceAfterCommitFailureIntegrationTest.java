package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.UserPrincipal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@DataJpaTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({MeetingAnalysisService.class, MeetingAnalysisPersistence.class})
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false",
    "workflow.uploads.dir=/tmp/workflow-analysis-service-after-commit-it"
})
class MeetingAnalysisServiceAfterCommitFailureIntegrationTest {

    @Autowired
    private MeetingAnalysisService service;

    @Autowired
    private MeetingRepository meetingRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @MockBean
    private MeetingAnalysisJobPublisher meetingAnalysisJobPublisher;

    @MockBean
    private DemoDataService demoDataService;

    @MockBean
    private ProjectMemberRepository projectMemberRepository;

    @MockBean
    private RagIngestService ragIngestService;

    @MockBean
    private NotificationService notificationService;

    @BeforeEach
    void setUp() {
        UserPrincipal principal = new UserPrincipal(1L, "user@example.com", "김민준");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 1L)).thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void afterCommitEnqueueFailureDurablyPersistsFailedStatusInNewTransaction() {
        doThrow(new IllegalStateException("redis unavailable"))
            .when(meetingAnalysisJobPublisher).enqueue(any(), any(), any(), any());

        MeetingAnalysisResponse response = service.analyze(
            "demo-project",
            null,
            "트랜잭션 회의",
            "2026-07-23",
            "정기회의",
            "document",
            List.of(),
            null
        );

        String status = new TransactionTemplate(transactionManager).execute(transactionStatus ->
            meetingRepository.findById(Long.valueOf(response.meetingId()))
                .orElseThrow()
                .getAnalysisStatus()
        );

        assertThat(status).isEqualTo("failed");
    }

    @Test
    void retryEnqueuesOnlyAfterCallerTransactionCommits() throws Exception {
        Path textFile = Files.createTempFile("workflow-retry-", ".txt");
        Files.writeString(textFile, "재시도할 회의록");
        Meeting meeting = meetingRepository.save(
            new Meeting(
                1L,
                "재시도 회의",
                "document",
                textFile.toString(),
                "failed",
                LocalDate.now(),
                "정기회의",
                "retry.txt",
                1L,
                Files.size(textFile)
            )
        );
        AtomicBoolean enqueueObserved = new AtomicBoolean();
        AtomicBoolean commitObserved = new AtomicBoolean();
        doAnswer(invocation -> {
            assertThat(commitObserved).isTrue();
            enqueueObserved.set(true);
            return null;
        }).when(meetingAnalysisJobPublisher).enqueue(any(), any(), any(), any());

        try {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        commitObserved.set(true);
                    }
                });
                service.retry("demo-project", String.valueOf(meeting.getId()));
            });
        } finally {
            Files.deleteIfExists(textFile);
        }

        assertThat(enqueueObserved).isTrue();
        assertThat(meetingRepository.findById(meeting.getId()).orElseThrow().getAnalysisStatus())
            .isEqualTo("processing");
    }
}
