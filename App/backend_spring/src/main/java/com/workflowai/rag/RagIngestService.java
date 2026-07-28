package com.workflowai.rag;

import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Recover;
import org.springframework.retry.annotation.Retryable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpClientErrorException;

// RAG 임베딩은 어시스턴트 답변 품질을 높이는 부가 기능이라, FastAPI 장애나 지연이
// 회의록/업무 저장 흐름(호출 스레드)을 막지 않도록 별도 스레드에서 처리하고 예외를 삼킨다.
@Service
public class RagIngestService {
    private static final Logger log = LoggerFactory.getLogger(RagIngestService.class);

    private final FastApiRagClient fastApiRagClient;
    private final RagAssigneeSyncFailureRepository ragAssigneeSyncFailureRepository;
    private final TaskRepository taskRepository;

    public RagIngestService(
        FastApiRagClient fastApiRagClient,
        RagAssigneeSyncFailureRepository ragAssigneeSyncFailureRepository,
        TaskRepository taskRepository
    ) {
        this.fastApiRagClient = fastApiRagClient;
        this.ragAssigneeSyncFailureRepository = ragAssigneeSyncFailureRepository;
        this.taskRepository = taskRepository;
    }

    @Async("ragIngestExecutor")
    @Retryable(
        recover = "recoverIngestWithoutAssignee",
        retryFor = Exception.class,
        noRetryFor = HttpClientErrorException.class,
        maxAttempts = 3,
        backoff = @Backoff(
            delayExpression = "${rag.assignee-sync.retry.delay-ms:1000}",
            multiplierExpression = "${rag.assignee-sync.retry.multiplier:2}"
        )
    )
    public void ingestBestEffort(Long projectId, String sourceType, Long sourceId, String content) {
        ingestBestEffort(projectId, sourceType, sourceId, content, null);
    }

    @Async("ragIngestExecutor")
    @Retryable(
        recover = "recoverIngest",
        retryFor = Exception.class,
        noRetryFor = HttpClientErrorException.class,
        maxAttempts = 3,
        backoff = @Backoff(
            delayExpression = "${rag.assignee-sync.retry.delay-ms:1000}",
            multiplierExpression = "${rag.assignee-sync.retry.multiplier:2}"
        )
    )
    public void ingestBestEffort(Long projectId, String sourceType, Long sourceId, String content, Long assigneeId) {
        if (projectId == null || sourceId == null || content == null || content.isBlank()) return;
        fastApiRagClient.ingest(new RagIngestRequest(projectId, sourceType, sourceId, content, assigneeId));
        deleteMatchingIngestIntent(projectId, sourceType, sourceId, content, assigneeId);
    }

    @Transactional
    public void recordIngestIntent(
        Long projectId,
        String sourceType,
        Long sourceId,
        String content,
        Long assigneeId
    ) {
        if (projectId == null || sourceType == null || sourceType.isBlank() || sourceId == null
            || content == null || content.isBlank()) {
            return;
        }
        String outboxSourceType = "ingest:" + sourceType;
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            outboxSourceType,
            sourceId
        );
        ragAssigneeSyncFailureRepository.save(
            new RagAssigneeSyncFailure(projectId, outboxSourceType, sourceId, assigneeId, content)
        );
    }

    // 담당자만 재배정된 경우(내용 변경 없음) - 이미 인제스트된 청크를 재임베딩하지 않고
    // assignee_id 메타데이터만 갱신한다. RAG 인제스트 자체가 안 됐던 소스(source_id)라면
    // FastAPI 쪽 UPDATE가 0건에 그칠 뿐이라 안전하다.
    // 일시적 장애(네트워크, FastAPI 재시작 등)에 대비해 지수 백오프로 최대 3회 재시도하고,
    // 그래도 실패하면 recoverSyncAssignee가 실패 기록만 남기고 예외를 삼킨다 (호출 스레드에
    // 영향 없어야 하므로 최종적으로도 예외를 던지지 않는다).
    @Async("ragIngestExecutor")
    @Retryable(
        recover = "recoverSyncAssignee",
        retryFor = Exception.class,
        noRetryFor = HttpClientErrorException.class,
        maxAttempts = 3,
        backoff = @Backoff(
            delayExpression = "${rag.assignee-sync.retry.delay-ms:1000}",
            multiplierExpression = "${rag.assignee-sync.retry.multiplier:2}"
        )
    )
    public void syncAssigneeBestEffort(Long projectId, String sourceType, Long sourceId, Long assigneeId) {
        if (projectId == null || sourceId == null) return;
        Long targetAssigneeId = assigneeId;
        for (int attempt = 0; attempt < 3; attempt++) {
            fastApiRagClient.syncAssignee(
                new RagAssigneeSyncRequest(projectId, sourceType, sourceId, targetAssigneeId)
            );
            if (!"task".equals(sourceType)) {
                deleteMatchingAssigneeIntent(projectId, sourceType, sourceId, targetAssigneeId);
                return;
            }
            Task latest = taskRepository.findById(sourceId).orElse(null);
            if (latest == null || !Objects.equals(latest.getProjectId(), projectId)) {
                ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
                    projectId,
                    "sync:" + sourceType,
                    sourceId
                );
                return;
            }
            if (Objects.equals(latest.getAssigneeId(), targetAssigneeId)) {
                deleteMatchingAssigneeIntent(projectId, sourceType, sourceId, targetAssigneeId);
                return;
            }
            targetAssigneeId = latest.getAssigneeId();
        }
        ragAssigneeSyncFailureRepository.save(
            new RagAssigneeSyncFailure(projectId, "sync:" + sourceType, sourceId, targetAssigneeId, "pending")
        );
    }

    @Transactional
    public void recordAssigneeSyncIntent(
        Long projectId,
        String sourceType,
        Long sourceId,
        Long assigneeId
    ) {
        if (projectId == null || sourceType == null || sourceType.isBlank() || sourceId == null) return;
        String outboxSourceType = "sync:" + sourceType;
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            outboxSourceType,
            sourceId
        );
        ragAssigneeSyncFailureRepository.save(
            new RagAssigneeSyncFailure(projectId, outboxSourceType, sourceId, assigneeId, "pending")
        );
    }

    @Transactional
    public void recordDeleteSourceIntent(Long projectId, String sourceType, Long sourceId) {
        if (projectId == null || sourceType == null || sourceType.isBlank() || sourceId == null) return;
        String outboxSourceType = "delete:" + sourceType;
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId, "ingest:" + sourceType, sourceId
        );
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId, "sync:" + sourceType, sourceId
        );
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            outboxSourceType,
            sourceId
        );
        ragAssigneeSyncFailureRepository.save(
            new RagAssigneeSyncFailure(projectId, outboxSourceType, sourceId, null, "pending")
        );
    }

    @Transactional
    public void recordDeleteProjectIntent(Long projectId) {
        if (projectId == null) return;
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeStartingWith(projectId, "ingest:");
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeStartingWith(projectId, "sync:");
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeStartingWith(projectId, "delete:");
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            "delete_project",
            0L
        );
        ragAssigneeSyncFailureRepository.save(
            new RagAssigneeSyncFailure(projectId, "delete_project", 0L, null, "pending")
        );
    }

    @Async("ragIngestExecutor")
    @Retryable(
        recover = "recoverDeleteSource",
        retryFor = Exception.class,
        noRetryFor = HttpClientErrorException.class,
        maxAttempts = 3,
        backoff = @Backoff(
            delayExpression = "${rag.assignee-sync.retry.delay-ms:1000}",
            multiplierExpression = "${rag.assignee-sync.retry.multiplier:2}"
        )
    )
    public void deleteSourceBestEffort(Long projectId, String sourceType, Long sourceId) {
        if (projectId == null || sourceId == null) return;
        fastApiRagClient.deleteSource(projectId, sourceType, sourceId);
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            "delete:" + sourceType,
            sourceId
        );
    }

    @Async("ragIngestExecutor")
    @Retryable(
        recover = "recoverDeleteProjectSources",
        retryFor = Exception.class,
        noRetryFor = HttpClientErrorException.class,
        maxAttempts = 3,
        backoff = @Backoff(
            delayExpression = "${rag.assignee-sync.retry.delay-ms:1000}",
            multiplierExpression = "${rag.assignee-sync.retry.multiplier:2}"
        )
    )
    public void deleteProjectSourcesBestEffort(Long projectId) {
        if (projectId == null) return;
        fastApiRagClient.deleteProjectSources(projectId);
        ragAssigneeSyncFailureRepository.deleteByProjectIdAndSourceTypeAndSourceId(
            projectId,
            "delete_project",
            0L
        );
    }

    @Recover
    public void recoverIngest(
        Exception e,
        Long projectId,
        String sourceType,
        Long sourceId,
        String content,
        Long assigneeId
    ) {
        log.warn("RAG ingest 재시도 모두 실패 (무시): sourceType={}, sourceId={}", sourceType, sourceId, e);
    }

    @Recover
    public void recoverIngestWithoutAssignee(
        Exception e,
        Long projectId,
        String sourceType,
        Long sourceId,
        String content
    ) {
        log.warn("RAG ingest 재시도 모두 실패 (무시): sourceType={}, sourceId={}", sourceType, sourceId, e);
    }

    @Recover
    public void recoverDeleteSource(Exception e, Long projectId, String sourceType, Long sourceId) {
        log.warn("RAG source 삭제 재시도 모두 실패, 저장된 의도를 유지: sourceType={}, sourceId={}", sourceType, sourceId, e);
    }

    @Recover
    public void recoverDeleteProjectSources(Exception e, Long projectId) {
        log.warn("RAG project source 삭제 재시도 모두 실패, 저장된 의도를 유지: projectId={}", projectId, e);
    }

    @Recover
    public void recoverSyncAssignee(Exception e, Long projectId, String sourceType, Long sourceId, Long assigneeId) {
        log.warn("RAG assignee 동기화 재시도 모두 실패, 저장된 의도를 유지: sourceType={}, sourceId={}", sourceType, sourceId, e);
    }

    @Scheduled(
        initialDelayString = "${rag.failure-replay.initial-delay-ms:60000}",
        fixedDelayString = "${rag.failure-replay.fixed-delay-ms:60000}"
    )
    public void replayFailures() {
        for (RagAssigneeSyncFailure failure :
            ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("delete")) {
            try {
                if ("delete_project".equals(failure.getSourceType())) {
                    fastApiRagClient.deleteProjectSources(failure.getProjectId());
                } else {
                    fastApiRagClient.deleteSource(
                        failure.getProjectId(),
                        failure.getSourceType().substring("delete:".length()),
                        failure.getSourceId()
                    );
                }
                ragAssigneeSyncFailureRepository.delete(failure);
            } catch (Exception exception) {
                log.warn(
                    "RAG 실패 재처리 보류: sourceType={}, sourceId={}, errorType={}",
                    failure.getSourceType(),
                    failure.getSourceId(),
                    exception.getClass().getSimpleName()
                );
            }
        }
        for (RagAssigneeSyncFailure failure :
            ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("sync:")) {
            replayAssigneeFailure(failure);
        }
        for (RagAssigneeSyncFailure failure :
            ragAssigneeSyncFailureRepository.findTop100BySourceTypeStartingWithOrderByFailedAtAsc("ingest:")) {
            replayIngestFailure(failure);
        }
    }

    private void replayIngestFailure(RagAssigneeSyncFailure failure) {
        try {
            String sourceType = failure.getSourceType().substring("ingest:".length());
            if (!ragAssigneeSyncFailureRepository
                .findByProjectIdAndSourceTypeAndSourceId(
                    failure.getProjectId(), "delete:" + sourceType, failure.getSourceId()
                ).isEmpty()
            ) {
                ragAssigneeSyncFailureRepository.delete(failure);
                return;
            }
            fastApiRagClient.ingest(new RagIngestRequest(
                failure.getProjectId(),
                sourceType,
                failure.getSourceId(),
                failure.getErrorMessage(),
                failure.getAssigneeId()
            ));
            ragAssigneeSyncFailureRepository.delete(failure);
        } catch (Exception exception) {
            log.warn(
                "RAG ingest 재처리 보류: sourceType={}, sourceId={}, errorType={}",
                failure.getSourceType(),
                failure.getSourceId(),
                exception.getClass().getSimpleName()
            );
        }
    }

    private void replayAssigneeFailure(RagAssigneeSyncFailure failure) {
        String sourceType = failure.getSourceType().substring("sync:".length());
        if (!"task".equals(sourceType)) {
            ragAssigneeSyncFailureRepository.delete(failure);
            return;
        }
        Task task = taskRepository.findById(failure.getSourceId()).orElse(null);
        if (task == null
            || !Objects.equals(task.getProjectId(), failure.getProjectId())
            || !Objects.equals(task.getAssigneeId(), failure.getAssigneeId())) {
            ragAssigneeSyncFailureRepository.delete(failure);
            return;
        }
        Long targetAssigneeId = failure.getAssigneeId();
        try {
            for (int attempt = 0; attempt < 3; attempt++) {
                fastApiRagClient.syncAssignee(
                    new RagAssigneeSyncRequest(
                        failure.getProjectId(),
                        sourceType,
                        failure.getSourceId(),
                        targetAssigneeId
                    )
                );
                Task latest = taskRepository.findById(failure.getSourceId()).orElse(null);
                if (latest == null || !Objects.equals(latest.getProjectId(), failure.getProjectId())) {
                    ragAssigneeSyncFailureRepository.delete(failure);
                    return;
                }
                if (Objects.equals(latest.getAssigneeId(), targetAssigneeId)) {
                    ragAssigneeSyncFailureRepository.delete(failure);
                    return;
                }
                targetAssigneeId = latest.getAssigneeId();
            }
            ragAssigneeSyncFailureRepository.save(
                new RagAssigneeSyncFailure(
                    failure.getProjectId(),
                    failure.getSourceType(),
                    failure.getSourceId(),
                    targetAssigneeId,
                    "pending"
                )
            );
            ragAssigneeSyncFailureRepository.delete(failure);
        } catch (Exception exception) {
            log.warn(
                "RAG 담당자 재처리 보류: sourceType={}, sourceId={}, errorType={}",
                sourceType,
                failure.getSourceId(),
                exception.getClass().getSimpleName()
            );
        }
    }

    private void deleteMatchingAssigneeIntent(
        Long projectId,
        String sourceType,
        Long sourceId,
        Long assigneeId
    ) {
        ragAssigneeSyncFailureRepository
            .findByProjectIdAndSourceTypeAndSourceId(projectId, "sync:" + sourceType, sourceId)
            .stream()
            .filter(failure -> Objects.equals(failure.getAssigneeId(), assigneeId))
            .forEach(ragAssigneeSyncFailureRepository::delete);
    }

    private void deleteMatchingIngestIntent(
        Long projectId,
        String sourceType,
        Long sourceId,
        String content,
        Long assigneeId
    ) {
        ragAssigneeSyncFailureRepository
            .findByProjectIdAndSourceTypeAndSourceId(projectId, "ingest:" + sourceType, sourceId)
            .stream()
            .filter(failure -> Objects.equals(failure.getErrorMessage(), content))
            .filter(failure -> Objects.equals(failure.getAssigneeId(), assigneeId))
            .forEach(ragAssigneeSyncFailureRepository::delete);
    }
}
