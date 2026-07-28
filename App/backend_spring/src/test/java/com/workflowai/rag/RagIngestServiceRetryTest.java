package com.workflowai.rag;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.annotation.EnableRetry;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.context.TestPropertySource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;

@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = RagIngestServiceRetryTest.RetryTestConfig.class)
@TestPropertySource(properties = {
    "rag.assignee-sync.retry.delay-ms=1",
    "rag.assignee-sync.retry.multiplier=1"
})
class RagIngestServiceRetryTest {

    @Autowired
    private RagIngestService ragIngestService;

    @Autowired
    private FastApiRagClient fastApiRagClient;

    @Autowired
    private RagAssigneeSyncFailureRepository ragAssigneeSyncFailureRepository;

    @Autowired
    private TaskRepository taskRepository;

    @BeforeEach
    void setUp() {
        reset(fastApiRagClient, ragAssigneeSyncFailureRepository, taskRepository);
    }

    @AfterEach
    void tearDown() {
        reset(fastApiRagClient, ragAssigneeSyncFailureRepository, taskRepository);
    }

    @Test
    void syncAssigneeRetriesAndSucceedsWithinAttemptLimit() {
        doThrow(new RestClientException("boom"))
            .doThrow(new RestClientException("boom"))
            .doNothing()
            .when(fastApiRagClient).syncAssignee(any());

        ragIngestService.syncAssigneeBestEffort(1L, "task", 10L, 99L);

        verify(fastApiRagClient, times(3)).syncAssignee(any());
    }

    @Test
    void syncAssigneeIntentIsRecordedBeforeDispatch() {
        ragIngestService.recordAssigneeSyncIntent(1L, "task", 10L, 99L);

        ArgumentCaptor<RagAssigneeSyncFailure> captor = ArgumentCaptor.forClass(RagAssigneeSyncFailure.class);
        verify(ragAssigneeSyncFailureRepository).save(captor.capture());
        assertThat(captor.getValue().getSourceType()).isEqualTo("sync:task");
        assertThat(captor.getValue().getAssigneeId()).isEqualTo(99L);
    }

    @Test
    void immediateSyncCompensatesWhenAssigneeChangesDuringFastApiCall() {
        Task after = mock(Task.class);
        when(after.getProjectId()).thenReturn(1L);
        when(after.getAssigneeId()).thenReturn(100L);
        when(taskRepository.findById(10L))
            .thenReturn(java.util.Optional.of(after))
            .thenReturn(java.util.Optional.of(after));

        ragIngestService.syncAssigneeBestEffort(1L, "task", 10L, 99L);

        ArgumentCaptor<RagAssigneeSyncRequest> requests = ArgumentCaptor.forClass(RagAssigneeSyncRequest.class);
        verify(fastApiRagClient, times(2)).syncAssignee(requests.capture());
        assertThat(requests.getAllValues()).extracting(RagAssigneeSyncRequest::assignee_id)
            .containsExactly(99L, 100L);
    }

    @Test
    void exhaustedAssigneeRetriesKeepPreRecordedIntent() {
        doThrow(new RestClientException("boom")).when(fastApiRagClient).syncAssignee(any());

        ragIngestService.syncAssigneeBestEffort(1L, "task", 10L, 99L);

        verify(fastApiRagClient, times(3)).syncAssignee(any());
        verifyNoInteractions(ragAssigneeSyncFailureRepository);
    }

    @Test
    void ingestRetriesTransientFastApiFailure() {
        doThrow(new RestClientException("boom"))
            .doThrow(new RestClientException("boom"))
            .when(fastApiRagClient).ingest(any());

        ragIngestService.ingestBestEffort(1L, "task", 10L, "업무 내용", 99L);

        verify(fastApiRagClient, times(3)).ingest(any());
    }

    @Test
    void ingestDoesNotRetryOnPermanentClientErrorFromFastApi() {
        doThrow(new HttpClientErrorException(HttpStatus.BAD_REQUEST))
            .when(fastApiRagClient).ingest(any());

        ragIngestService.ingestBestEffort(1L, "task", 10L, "업무 내용", 99L);

        verify(fastApiRagClient, times(1)).ingest(any());
    }

    @Test
    void ingestIntentPersistsContentBeforeDispatch() {
        ragIngestService.recordIngestIntent(1L, "task", 10L, "최신 업무 내용", 99L);

        ArgumentCaptor<RagAssigneeSyncFailure> captor = ArgumentCaptor.forClass(RagAssigneeSyncFailure.class);
        verify(ragAssigneeSyncFailureRepository).save(captor.capture());
        assertThat(captor.getValue().getSourceType()).isEqualTo("ingest:task");
        assertThat(captor.getValue().getErrorMessage()).isEqualTo("최신 업무 내용");
        assertThat(captor.getValue().getAssigneeId()).isEqualTo(99L);
    }

    @Test
    void replayIngestUsesDurableContentAndDeletesCompletedIntent() {
        RagAssigneeSyncFailure failure = new RagAssigneeSyncFailure(
            1L,
            "ingest:task",
            10L,
            99L,
            "최신 업무 내용"
        );
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("ingest:"))
            .thenReturn(List.of(failure));

        ragIngestService.replayFailures();

        verify(fastApiRagClient).ingest(new RagIngestRequest(1L, "task", 10L, "최신 업무 내용", 99L));
        verify(ragAssigneeSyncFailureRepository).delete(failure);
    }

    @Test
    void replayIngestDropsIntentWhenDeleteTombstoneExists() {
        RagAssigneeSyncFailure failure = new RagAssigneeSyncFailure(
            1L, "ingest:task", 10L, 99L, "삭제되어야 할 원문"
        );
        RagAssigneeSyncFailure tombstone = new RagAssigneeSyncFailure(
            1L, "delete:task", 10L, null, "pending"
        );
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("ingest:"))
            .thenReturn(List.of(failure));
        when(ragAssigneeSyncFailureRepository.findByProjectIdAndSourceTypeAndSourceId(1L, "delete:task", 10L))
            .thenReturn(List.of(tombstone));

        ragIngestService.replayFailures();

        verify(fastApiRagClient, org.mockito.Mockito.never()).ingest(any());
        verify(ragAssigneeSyncFailureRepository).delete(failure);
    }

    @Test
    void deleteSourceRetriesTransientFastApiFailure() {
        doThrow(new RestClientException("boom"))
            .doThrow(new RestClientException("boom"))
            .doNothing()
            .when(fastApiRagClient).deleteSource(1L, "task", 10L);

        ragIngestService.deleteSourceBestEffort(1L, "task", 10L);

        verify(fastApiRagClient, times(3)).deleteSource(1L, "task", 10L);
        verify(ragAssigneeSyncFailureRepository)
            .deleteByProjectIdAndSourceTypeAndSourceId(1L, "delete:task", 10L);
    }

    @Test
    void deleteSourceIntentIsRecordedBeforeDispatch() {
        ragIngestService.recordDeleteSourceIntent(1L, "task", 10L);

        ArgumentCaptor<RagAssigneeSyncFailure> captor = ArgumentCaptor.forClass(RagAssigneeSyncFailure.class);
        verify(ragAssigneeSyncFailureRepository).save(captor.capture());
        assertThat(captor.getValue().getSourceType()).isEqualTo("delete:task");
        assertThat(captor.getValue().getSourceId()).isEqualTo(10L);
    }

    @Test
    void exhaustedDeleteRetriesKeepPreRecordedIntent() {
        doThrow(new RestClientException("boom"))
            .when(fastApiRagClient).deleteSource(1L, "task", 10L);

        ragIngestService.deleteSourceBestEffort(1L, "task", 10L);

        verifyNoInteractions(ragAssigneeSyncFailureRepository);
    }

    @Test
    void deleteProjectIntentIsRecordedBeforeDispatch() {
        ragIngestService.recordDeleteProjectIntent(1L);

        ArgumentCaptor<RagAssigneeSyncFailure> captor = ArgumentCaptor.forClass(RagAssigneeSyncFailure.class);
        verify(ragAssigneeSyncFailureRepository).save(captor.capture());
        assertThat(captor.getValue().getSourceType()).isEqualTo("delete_project");
        assertThat(captor.getValue().getSourceId()).isZero();
    }

    @Test
    void exhaustedProjectDeleteRetriesKeepPreRecordedIntent() {
        doThrow(new RestClientException("boom"))
            .when(fastApiRagClient).deleteProjectSources(1L);

        ragIngestService.deleteProjectSourcesBestEffort(1L);

        verifyNoInteractions(ragAssigneeSyncFailureRepository);
    }

    @Test
    void replayFailuresDeletesSourceAndRemovesDurableRecord() {
        RagAssigneeSyncFailure failure = new RagAssigneeSyncFailure(
            1L,
            "delete:task",
            10L,
            null,
            "RestClientException"
        );
        org.mockito.Mockito.when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete"))
            .thenReturn(List.of(failure));

        ragIngestService.replayFailures();

        verify(fastApiRagClient).deleteSource(1L, "task", 10L);
        verify(ragAssigneeSyncFailureRepository).delete(failure);
    }

    @Test
    void replayDoesNotApplyLegacyAssigneeFailures() {
        when(
            ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete")
        ).thenReturn(List.of());
        when(
            ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:")
        ).thenReturn(List.of());

        ragIngestService.replayFailures();

        verify(ragAssigneeSyncFailureRepository)
            .findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete");
        verify(ragAssigneeSyncFailureRepository)
            .findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:");
        verifyNoInteractions(fastApiRagClient);
    }

    @Test
    void replayDropsStaleAssigneeIntentInsteadOfRestoringOldAssignee() {
        RagAssigneeSyncFailure stale = new RagAssigneeSyncFailure(1L, "sync:task", 10L, 99L, "pending");
        Task currentTask = mock(Task.class);
        when(currentTask.getProjectId()).thenReturn(1L);
        when(currentTask.getAssigneeId()).thenReturn(100L);
        when(taskRepository.findById(10L)).thenReturn(java.util.Optional.of(currentTask));
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:"))
            .thenReturn(List.of(stale));

        ragIngestService.replayFailures();

        verify(fastApiRagClient, org.mockito.Mockito.never()).syncAssignee(any());
        verify(ragAssigneeSyncFailureRepository).delete(stale);
    }

    @Test
    void replayCompensatesWhenAssigneeChangesDuringFastApiCall() {
        RagAssigneeSyncFailure oldIntent = new RagAssigneeSyncFailure(1L, "sync:task", 10L, 99L, "pending");
        Task before = mock(Task.class);
        when(before.getProjectId()).thenReturn(1L);
        when(before.getAssigneeId()).thenReturn(99L);
        Task after = mock(Task.class);
        when(after.getProjectId()).thenReturn(1L);
        when(after.getAssigneeId()).thenReturn(100L);
        when(taskRepository.findById(10L))
            .thenReturn(java.util.Optional.of(before))
            .thenReturn(java.util.Optional.of(after))
            .thenReturn(java.util.Optional.of(after));
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete"))
            .thenReturn(List.of());
        when(ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:"))
            .thenReturn(List.of(oldIntent));

        ragIngestService.replayFailures();

        ArgumentCaptor<RagAssigneeSyncRequest> requests = ArgumentCaptor.forClass(RagAssigneeSyncRequest.class);
        verify(fastApiRagClient, times(2)).syncAssignee(requests.capture());
        assertThat(requests.getAllValues()).extracting(RagAssigneeSyncRequest::assignee_id)
            .containsExactly(99L, 100L);
        verify(ragAssigneeSyncFailureRepository).delete(oldIntent);
    }

    @Configuration
    @EnableRetry
    static class RetryTestConfig {
        @Bean
        FastApiRagClient fastApiRagClient() {
            return mock(FastApiRagClient.class);
        }

        @Bean
        RagAssigneeSyncFailureRepository ragAssigneeSyncFailureRepository() {
            return mock(RagAssigneeSyncFailureRepository.class);
        }

        @Bean
        TaskRepository taskRepository() {
            return mock(TaskRepository.class);
        }

        @Bean
        RagIngestService ragIngestService(
            FastApiRagClient client,
            RagAssigneeSyncFailureRepository repo,
            TaskRepository taskRepository
        ) {
            return new RagIngestService(client, repo, taskRepository);
        }
    }
}
