package com.workflowai.meeting;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
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
import org.springframework.data.domain.Range;
import org.springframework.stereotype.Component;

@Component
public class MeetingAnalysisQueueWorker implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MeetingAnalysisQueueWorker.class);

    private static final String GROUP = "meeting-analysis-workers";
    private static final String CONSUMER_PREFIX = "meeting-analysis-worker";
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
        MeetingAnalysisJobPublisher.STREAM_KEY,
        ReadOffset.from("0")
    );
    private static final StreamOffset<String> NEW_OFFSET = StreamOffset.create(
        MeetingAnalysisJobPublisher.STREAM_KEY,
        ReadOffset.lastConsumed()
    );

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final MeetingRepository meetingRepository;
    private final MeetingAnalysisRunner runner;
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
    public MeetingAnalysisQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        MeetingRepository meetingRepository,
        MeetingAnalysisRunner runner
    ) {
        this(
            redisTemplate,
            objectMapper,
            meetingRepository,
            runner,
            MeetingAnalysisQueueWorker::sleep,
            CONSUMER_PREFIX + "-" + UUID.randomUUID(),
            null
        );
    }

    MeetingAnalysisQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        MeetingRepository meetingRepository,
        MeetingAnalysisRunner runner,
        LongConsumer delay
    ) {
        this(redisTemplate, objectMapper, meetingRepository, runner, delay, CONSUMER_PREFIX, null);
    }

    MeetingAnalysisQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        MeetingRepository meetingRepository,
        MeetingAnalysisRunner runner,
        LongConsumer delay,
        String consumerName
    ) {
        this(redisTemplate, objectMapper, meetingRepository, runner, delay, consumerName, null);
    }

    MeetingAnalysisQueueWorker(
        StringRedisTemplate redisTemplate,
        ObjectMapper objectMapper,
        MeetingRepository meetingRepository,
        MeetingAnalysisRunner runner,
        LongConsumer delay,
        String consumerName,
        ScheduledExecutorService pendingLeaseExecutor
    ) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.meetingRepository = meetingRepository;
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
            doPollOnce();
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
                Objects.requireNonNull(redisTemplate.getStringSerializer().serialize(MeetingAnalysisJobPublisher.STREAM_KEY)),
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

    private void doPollOnce() {
        StreamOperations<String, String, String> operations = streamOperations();
        List<MapRecord<String, String, String>> records = operations.read(consumer, PENDING_READ_OPTIONS, PENDING_OFFSET);
        if (records == null || records.isEmpty()) {
            records = claimStalePending(operations);
        }
        if (records == null || records.isEmpty()) {
            records = operations.read(consumer, NEW_READ_OPTIONS, NEW_OFFSET);
        }
        if (records == null || records.isEmpty()) {
            return;
        }
        process(records.getFirst());
    }

    private List<MapRecord<String, String, String>> claimStalePending(
        StreamOperations<String, String, String> operations
    ) {
        Range<?> pendingRange = Range.unbounded();
        while (true) {
            PendingMessages pending = operations.pending(
                MeetingAnalysisJobPublisher.STREAM_KEY,
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
                    MeetingAnalysisJobPublisher.STREAM_KEY,
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

    private void process(MapRecord<String, String, String> record) {
        MeetingAnalysisJob job;
        try {
            job = deserialize(record);
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            log.warn("Discarding malformed meeting analysis record. recordId={}", record.getId().getValue());
            acknowledgeAndDelete(record.getId());
            return;
        }

        Optional<Meeting> meeting;
        try {
            meeting = meetingRepository.findById(job.meetingId());
        } catch (DataAccessException exception) {
            log.warn(
                "Meeting lookup failed; record remains pending. recordId={}, jobId={}, meetingId={}, errorType={}",
                record.getId().getValue(),
                job.jobId(),
                job.meetingId(),
                exception.getClass().getSimpleName()
            );
            return;
        }
        if (meeting.isEmpty() || isTerminal(meeting.get().getAnalysisStatus())) {
            log.info(
                "Skipping terminal meeting analysis job. recordId={}, jobId={}, meetingId={}",
                record.getId().getValue(),
                job.jobId(),
                job.meetingId()
            );
            acknowledgeAndDelete(record.getId());
            return;
        }

        ScheduledFuture<?> pendingLease = startPendingLeaseRefresh(record.getId());
        if (pendingLease == null) {
            return;
        }
        try {
            runner.runAnalysis(job.meetingId(), job.request(), UUID.fromString(job.jobId()), job.requestedBy());
        } catch (RuntimeException exception) {
            log.warn(
                "Meeting analysis runner failed; record remains pending. recordId={}, jobId={}, meetingId={}, errorType={}",
                record.getId().getValue(),
                job.jobId(),
                job.meetingId(),
                exception.getClass().getSimpleName()
            );
            return;
        } finally {
            pendingLease.cancel(false);
        }
        acknowledgeAndDelete(record.getId());
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
                recordId.getValue(),
                exception.getClass().getSimpleName()
            );
            return null;
        }
    }

    private void refreshPendingLease(RecordId recordId) {
        try {
            streamOperations().claim(
                MeetingAnalysisJobPublisher.STREAM_KEY,
                GROUP,
                consumerName,
                Duration.ZERO,
                recordId
            );
        } catch (RuntimeException exception) {
            log.warn(
                "Pending lease refresh failed. recordId={}, errorType={}",
                recordId.getValue(),
                exception.getClass().getSimpleName()
            );
        }
    }

    private MeetingAnalysisJob deserialize(MapRecord<String, String, String> record) throws JsonProcessingException {
        String payload = record.getValue().get(PAYLOAD_FIELD);
        MeetingAnalysisJob job = objectMapper.readValue(payload, MeetingAnalysisJob.class);
        if (job.jobId() == null || job.jobId().isBlank() || job.meetingId() == null || job.request() == null) {
            throw new IllegalArgumentException("Missing required job field");
        }
        UUID.fromString(job.jobId());
        return job;
    }

    private void acknowledgeAndDelete(RecordId recordId) {
        redisTemplate.execute(
            ACK_AND_DELETE_SCRIPT,
            List.of(MeetingAnalysisJobPublisher.STREAM_KEY),
            GROUP,
            recordId.getValue()
        );
    }

    @SuppressWarnings("unchecked")
    private StreamOperations<String, String, String> streamOperations() {
        return (StreamOperations<String, String, String>) (StreamOperations<?, ?, ?>) redisTemplate.opsForStream();
    }

    private boolean isTerminal(String status) {
        if (status == null) {
            return false;
        }
        String normalized = status.toLowerCase(Locale.ROOT);
        return normalized.equals("completed") || normalized.equals("failed");
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
