package com.workflowai.dashboard.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.project.ProjectRepository;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.LongConsumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * dashboard-ai-jobs Redis Stream을 소비해 지연 위험도 재분석/업무 편중 계산 작업을 처리한다.
 * MeetingAnalysisQueueWorker와 동일한 consumer-group 패턴(대기 메시지 우선 처리 → 정체된 pending
 * 가로채기 → 새 메시지 대기)을 따른다.
 */
@Component
public class DashboardAiQueueWorker implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DashboardAiQueueWorker.class);

    private static final String GROUP = "dashboard-ai-workers";
    private static final String CONSUMER_PREFIX = "dashboard-ai-worker";
    private static final String PAYLOAD_FIELD = "payload";
    private static final long INITIAL_BACKOFF_MILLIS = 250L;
    private static final long MAX_BACKOFF_MILLIS = 5_000L;
    private static final long SHUTDOWN_JOIN_MILLIS = 6_000L;
    private static final long PENDING_SCAN_COUNT = 100L;
    private static final Duration STALE_PENDING_IDLE = Duration.ofMinutes(10);

    private static final RedisScript<Long> ACK_AND_DELETE_SCRIPT = RedisScript.of(
        """
        if not redis.acl_check_cmd('XACK', KEYS[1], ARGV[1], ARGV[2]) then
            return redis.error_reply('XACK permission denied')
        end
        if not redis.acl_check_cmd('XDEL', KEYS[1], ARGV[2]) then
            return redis.error_reply('XDEL permission denied')
        end
        redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
        return redis.call('XDEL', KEYS[1], ARGV[2])
        """,
        Long.class
    );

    private static final StreamReadOptions PENDING_READ_OPTIONS = StreamReadOptions.empty().count(1);
    private static final StreamReadOptions NEW_READ_OPTIONS = StreamReadOptions.empty()
        .block(Duration.ofSeconds(5))
        .count(1);
    private static final StreamOffset<String> PENDING_OFFSET = StreamOffset.create(
        DashboardAiJobPublisher.STREAM_KEY,
        ReadOffset.from("0")
    );
    private static final StreamOffset<String> NEW_OFFSET = StreamOffset.create(
        DashboardAiJobPublisher.STREAM_KEY,
        ReadOffset.lastConsumed()
    );

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final ProjectRepository projectRepository;
    private final DashboardAiJobPublisher publisher;
    private final DashboardAiJobRunner runner;
    private final LongConsumer delay;
    private final String consumerName;
    private final Consumer consumer;
    private final ScheduledExecutorService pendingLeaseExecutor;

    private volatile boolean running;
    private volatile boolean groupInitialized;
    private volatile Thread workerThread;
    private long nextBackoffMillis = INITIAL_BACKOFF_MILLIS;

    // 테스트용 오버로드가 있어 생성자가 여러 개다. 표시가 없으면 Spring이 기본 생성자를 찾다 기동에 실패한다.
    @Autowired
    public DashboardAiQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        ProjectRepository projectRepository,
        DashboardAiJobPublisher publisher,
        DashboardAiJobRunner runner
    ) {
        this(
            redisTemplate,
            objectMapper,
            projectRepository,
            publisher,
            runner,
            DashboardAiQueueWorker::sleep,
            CONSUMER_PREFIX + "-" + UUID.randomUUID(),
            null
        );
    }

    DashboardAiQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        ProjectRepository projectRepository,
        DashboardAiJobPublisher publisher,
        DashboardAiJobRunner runner,
        LongConsumer delay,
        String consumerName,
        ScheduledExecutorService pendingLeaseExecutor
    ) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.projectRepository = projectRepository;
        this.publisher = publisher;
        this.runner = runner;
        this.delay = delay;
        this.consumerName = consumerName;
        this.consumer = Consumer.from(GROUP, consumerName);
        this.pendingLeaseExecutor = pendingLeaseExecutor == null
            ? createPendingLeaseExecutor(consumerName)
            : pendingLeaseExecutor;
    }

    @Override
    public synchronized void run(ApplicationArguments arguments) {
        if (running) {
            return;
        }
        running = true;
        Thread thread = new Thread(this::workLoop, consumerName);
        thread.setDaemon(true);
        workerThread = thread;
        thread.start();
    }

    void pollOnce() {
        try {
            // 레코드를 ack하지 못하고 pending으로 남긴 경우(DB 조회 실패, 리스 스케줄링 실패,
            // 러너 예외) 다음 폴링의 PENDING 읽기가 같은 레코드를 논블로킹으로 즉시 다시 집어온다.
            // 여기서 백오프를 태우지 않으면 원인이 해소될 때까지 스핀 루프로 CPU와 DB/FastAPI를
            // 계속 때린다 - Redis 장애와 동일한 지수 백오프를 적용한다.
            if (doPollOnce()) {
                delay.accept(nextBackoffMillis);
                nextBackoffMillis = Math.min(nextBackoffMillis * 2, MAX_BACKOFF_MILLIS);
                return;
            }
            nextBackoffMillis = INITIAL_BACKOFF_MILLIS;
        } catch (DataAccessException exception) {
            log.warn("Redis Stream poll failed. errorType={}", exception.getClass().getSimpleName());
            delay.accept(nextBackoffMillis);
            nextBackoffMillis = Math.min(nextBackoffMillis * 2, MAX_BACKOFF_MILLIS);
        }
    }

    public boolean isReady() {
        return groupInitialized && running && isWorkerAlive();
    }

    public boolean isWorkerAlive() {
        Thread thread = workerThread;
        return thread != null && thread.isAlive();
    }

    @PreDestroy
    synchronized void shutdown() {
        running = false;
        groupInitialized = false;
        pendingLeaseExecutor.shutdownNow();
        Thread thread = workerThread;
        if (thread == null) {
            return;
        }
        thread.interrupt();
        try {
            thread.join(SHUTDOWN_JOIN_MILLIS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private void workLoop() {
        while (running) {
            if (!groupInitialized) {
                initializeGroup();
                continue;
            }
            pollOnce();
        }
    }

    private void initializeGroup() {
        try {
            redisTemplate.execute((RedisCallback<String>) connection -> connection.streamCommands().xGroupCreate(
                Objects.requireNonNull(redisTemplate.getStringSerializer().serialize(DashboardAiJobPublisher.STREAM_KEY)),
                GROUP,
                ReadOffset.from("0"),
                true
            ));
            groupInitialized = true;
            nextBackoffMillis = INITIAL_BACKOFF_MILLIS;
        } catch (DataAccessException exception) {
            if (isBusyGroup(exception)) {
                groupInitialized = true;
                nextBackoffMillis = INITIAL_BACKOFF_MILLIS;
                return;
            }
            log.warn("Redis Stream group initialization failed. errorType={}", exception.getClass().getSimpleName());
            delay.accept(nextBackoffMillis);
            nextBackoffMillis = Math.min(nextBackoffMillis * 2, MAX_BACKOFF_MILLIS);
        }
    }

    /** @return 레코드를 ack하지 못하고 pending으로 남겼는지(= 호출부가 백오프를 태워야 하는지). */
    private boolean doPollOnce() {
        StreamOperations<String, String, String> operations = streamOperations();
        List<MapRecord<String, String, String>> records = operations.read(consumer, PENDING_READ_OPTIONS, PENDING_OFFSET);
        if (records == null || records.isEmpty()) {
            records = claimStalePending(operations);
        }
        if (records == null || records.isEmpty()) {
            records = operations.read(consumer, NEW_READ_OPTIONS, NEW_OFFSET);
        }
        if (records == null || records.isEmpty()) {
            // 처리할 게 없는 정상 유휴 상태. NEW_READ_OPTIONS의 5초 블로킹이 이미 폴링 간격을
            // 잡아 주므로 백오프는 필요 없다.
            return false;
        }
        return process(records.getFirst());
    }

    private List<MapRecord<String, String, String>> claimStalePending(
        StreamOperations<String, String, String> operations
    ) {
        Range<?> pendingRange = Range.unbounded();
        while (true) {
            PendingMessages pending = operations.pending(
                DashboardAiJobPublisher.STREAM_KEY,
                GROUP,
                pendingRange,
                PENDING_SCAN_COUNT
            );
            if (pending == null || pending.isEmpty()) {
                return List.of();
            }
            for (PendingMessage message : pending) {
                if (consumerName.equals(message.getConsumerName())
                    || message.getElapsedTimeSinceLastDelivery().compareTo(STALE_PENDING_IDLE) < 0) {
                    continue;
                }
                return operations.claim(
                    DashboardAiJobPublisher.STREAM_KEY,
                    GROUP,
                    consumerName,
                    STALE_PENDING_IDLE,
                    message.getId()
                );
            }
            if (pending.size() < PENDING_SCAN_COUNT) {
                return List.of();
            }
            pendingRange = Range.rightUnbounded(
                Range.Bound.exclusive(pending.get(pending.size() - 1).getIdAsString())
            );
        }
    }

    /** @return 레코드를 ack하지 못하고 pending으로 남겼는지(= 호출부가 백오프를 태워야 하는지). */
    private boolean process(MapRecord<String, String, String> record) {
        DashboardAiJob job;
        try {
            job = deserialize(record);
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            log.warn("Discarding malformed dashboard AI job record. recordId={}", record.getId().getValue());
            acknowledgeAndDelete(record.getId());
            return false;
        }

        boolean projectExists;
        try {
            projectExists = projectRepository.existsById(job.projectId());
        } catch (DataAccessException exception) {
            log.warn(
                "Project lookup failed; record remains pending. recordId={}, jobId={}, projectId={}, errorType={}",
                record.getId().getValue(), job.jobId(), job.projectId(), exception.getClass().getSimpleName()
            );
            return true;
        }
        if (!projectExists) {
            log.info(
                "Skipping dashboard AI job for missing project. recordId={}, jobId={}, projectId={}",
                record.getId().getValue(), job.jobId(), job.projectId()
            );
            acknowledgeAndDelete(record.getId());
            publisher.releaseInFlight(job.projectId(), job.jobType(), job.jobId());
            return false;
        }

        ScheduledFuture<?> pendingLease = startPendingLeaseRefresh(record.getId());
        if (pendingLease == null) {
            return true;
        }
        boolean succeeded;
        try {
            succeeded = runner.runJob(job);
        } catch (RuntimeException exception) {
            log.warn(
                "Dashboard AI job runner failed; record remains pending. recordId={}, jobId={}, projectId={}, jobType={}, errorType={}",
                record.getId().getValue(), job.jobId(), job.projectId(), job.jobType(), exception.getClass().getSimpleName()
            );
            return true;
        } finally {
            pendingLease.cancel(false);
        }
        // 러너가 FastAPI 실패를 삼키고 정상 반환하므로, 완료 마커는 실제로 성공했을 때만 남긴다.
        // 실패 시 in-flight 마커만 풀면 상태 조회가 FAILED를 반환해 프론트가 옛 결과를 새 분석
        // 결과로 표시하지 않는다. 재시도는 사용자가 버튼을 다시 눌러 새 작업으로 적재한다 -
        // FastAPI 장애 중 같은 레코드를 큐에서 계속 되돌리면 워커가 그 작업에 묶여 버린다.
        //
        // 마커 기록을 ACK/삭제보다 먼저 한다. 순서가 반대면 그 사이 Redis 오류가 났을 때
        // 레코드는 이미 사라졌는데 완료 마커는 없어, 실제로 성공한 재분석이 영구히 FAILED로
        // 보고된다(레코드가 없으니 재시도도 안 된다). 이 순서라면 ACK 실패 시 레코드가 pending에
        // 남아 STALE_PENDING_IDLE 뒤 회수되며, 재실행은 예측을 다시 계산할 뿐이라 안전하다.
        if (succeeded) {
            publisher.markDone(job.projectId(), job.jobType(), job.jobId());
        } else {
            publisher.releaseInFlight(job.projectId(), job.jobType(), job.jobId());
        }
        acknowledgeAndDelete(record.getId());
        return false;
    }

    private ScheduledFuture<?> startPendingLeaseRefresh(RecordId recordId) {
        try {
            return pendingLeaseExecutor.scheduleWithFixedDelay(
                () -> refreshPendingLease(recordId),
                1L,
                1L,
                TimeUnit.MINUTES
            );
        } catch (RuntimeException exception) {
            log.warn(
                "Pending lease refresh scheduling failed; record remains pending. recordId={}, errorType={}",
                recordId.getValue(), exception.getClass().getSimpleName()
            );
            return null;
        }
    }

    private void refreshPendingLease(RecordId recordId) {
        try {
            streamOperations().claim(
                DashboardAiJobPublisher.STREAM_KEY,
                GROUP,
                consumerName,
                Duration.ZERO,
                recordId
            );
        } catch (RuntimeException exception) {
            log.warn("Pending lease refresh failed. recordId={}, errorType={}", recordId.getValue(), exception.getClass().getSimpleName());
        }
    }

    private DashboardAiJob deserialize(MapRecord<String, String, String> record) throws JsonProcessingException {
        String payload = record.getValue().get(PAYLOAD_FIELD);
        DashboardAiJob job = objectMapper.readValue(payload, DashboardAiJob.class);
        if (job.jobId() == null || job.jobId().isBlank() || job.projectId() == null || job.jobType() == null) {
            throw new IllegalArgumentException("Missing required job field");
        }
        UUID.fromString(job.jobId());
        return job;
    }

    private void acknowledgeAndDelete(RecordId recordId) {
        redisTemplate.execute(
            ACK_AND_DELETE_SCRIPT,
            List.of(DashboardAiJobPublisher.STREAM_KEY),
            GROUP,
            recordId.getValue()
        );
    }

    @SuppressWarnings("unchecked")
    private StreamOperations<String, String, String> streamOperations() {
        return (StreamOperations<String, String, String>) (StreamOperations<?, ?, ?>) redisTemplate.opsForStream();
    }

    private boolean isBusyGroup(Throwable exception) {
        Throwable current = exception;
        while (current != null) {
            if (current.getMessage() != null && current.getMessage().contains("BUSYGROUP")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private static ScheduledExecutorService createPendingLeaseExecutor(String consumerName) {
        return Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, consumerName + "-lease");
            thread.setDaemon(true);
            return thread;
        });
    }
}
