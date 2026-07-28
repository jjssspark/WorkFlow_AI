package com.workflowai.dashboard.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * 대시보드 재분석 요청(지연 위험도 재분석, 업무 편중 계산)을 Redis Stream에 적재한다.
 * 같은 프로젝트에 대해 같은 종류의 작업이 이미 큐/워커에 떠 있으면(in-flight), 새로 적재하지 않고
 * 기존 jobId를 그대로 돌려준다 — 재분석 버튼이 연타되거나 여러 팀원이 동시에 눌러도
 * FastAPI가 중복 호출되지 않는다("중복 요청 병합").
 */
@Component
public class DashboardAiJobPublisher {

    public static final String STREAM_KEY = "dashboard-ai-jobs";
    public static final int MAX_PAYLOAD_BYTES = 1024 * 1024;
    public static final int MAX_OUTSTANDING_JOBS = 1000;
    static final String QUEUE_FULL_SENTINEL = "QUEUE_FULL";

    /** 워커가 죽는 등으로 in-flight 마커를 못 지우는 경우를 대비한 안전장치. 지연 위험도/편중 계산은
     * 수초~수십초면 끝나므로, 이보다 훨씬 긴 여유를 두고 자동 만료시킨다. */
    private static final Duration IN_FLIGHT_TTL = Duration.ofMinutes(5);
    private static final String IN_FLIGHT_KEY_PREFIX = "dashboard-ai-inflight:";

    private static final String ENQUEUE_FAILURE_MESSAGE = "Failed to enqueue dashboard AI job";
    private static final RedisScript<String> ENQUEUE_IF_CAPACITY_SCRIPT = RedisScript.of(
        new ClassPathResource("redis/dashboard-ai-enqueue.lua"),
        String.class
    );

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public DashboardAiJobPublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * 작업을 큐에 적재한다. 같은 (projectId, jobType)의 작업이 이미 진행 중이면 적재하지 않고
     * 그 작업의 jobId를 그대로 반환한다(merged=true 취급은 호출부에서 필요 시 판단).
     */
    public String enqueue(Long projectId, DashboardAiJobType jobType, Long requestedBy) {
        String inFlightKey = inFlightKey(projectId, jobType);
        UUID jobId = UUID.randomUUID();

        Boolean claimed = redisTemplate.opsForValue().setIfAbsent(inFlightKey, jobId.toString(), IN_FLIGHT_TTL);
        if (Boolean.FALSE.equals(claimed)) {
            String existingJobId = redisTemplate.opsForValue().get(inFlightKey);
            return existingJobId != null ? existingJobId : jobId.toString();
        }

        try {
            return doEnqueue(projectId, jobType, jobId, requestedBy);
        } catch (RuntimeException exception) {
            redisTemplate.delete(inFlightKey);
            throw exception;
        }
    }

    /** 워커가 작업을 끝낸 뒤(성공/실패 모두) 호출해 in-flight 마커를 지운다. 다음 요청부터 다시 적재될 수 있다. */
    public void releaseInFlight(Long projectId, DashboardAiJobType jobType) {
        redisTemplate.delete(inFlightKey(projectId, jobType));
    }

    /** 주어진 jobId가 아직 in-flight 마커의 주인이면 처리 중, 아니면(만료/해제/다른 작업으로 교체) 완료로 본다. */
    public boolean isJobActive(Long projectId, DashboardAiJobType jobType, String jobId) {
        String current = redisTemplate.opsForValue().get(inFlightKey(projectId, jobType));
        return jobId.equals(current);
    }

    private String doEnqueue(Long projectId, DashboardAiJobType jobType, UUID jobId, Long requestedBy) {
        DashboardAiJob job = new DashboardAiJob(jobId.toString(), projectId, jobType, requestedBy);
        String payload = serialize(job);
        if (payload.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD_BYTES) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
        }

        String recordId;
        try {
            recordId = redisTemplate.execute(
                ENQUEUE_IF_CAPACITY_SCRIPT,
                List.of(STREAM_KEY),
                Integer.toString(MAX_OUTSTANDING_JOBS),
                payload
            );
        } catch (RuntimeException exception) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE, exception);
        }
        if (recordId == null || QUEUE_FULL_SENTINEL.equals(recordId)) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
        }
        return jobId.toString();
    }

    private String serialize(DashboardAiJob job) {
        try {
            return objectMapper.writeValueAsString(job);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE, exception);
        }
    }

    private static String inFlightKey(Long projectId, DashboardAiJobType jobType) {
        return IN_FLIGHT_KEY_PREFIX + projectId + ":" + jobType;
    }
}
