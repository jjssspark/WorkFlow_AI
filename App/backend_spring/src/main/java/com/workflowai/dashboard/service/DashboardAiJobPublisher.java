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

    /** 워커가 실제로 작업을 완료했을 때만 세팅되는 마커. in-flight 마커가 사라진 이유(완료/TTL 만료/
     * 재시도 대기 중)를 구분하지 못하면 실패·정체 중인 작업도 "완료"로 잘못 보고하게 된다 — 그래서
     * "완료"는 반드시 이 마커의 존재로만 판단한다. 클라이언트 폴링 주기(2초)보다 훨씬 길게 잡아
     * 폴링이 놓치지 않게 한다. */
    private static final Duration DONE_TTL = Duration.ofMinutes(5);
    private static final String DONE_KEY_PREFIX = "dashboard-ai-done:";

    /** enqueue()가 in-flight 마커 경합(다른 요청이 setIfAbsent에는 성공했지만 그 사이 TTL 만료/
     * release로 사라진 경우)에서 무한 루프에 빠지지 않도록 하는 상한. 이 안에 반드시 승부가 난다 —
     * 두 번째 시도에서도 실패한다면 그건 계속 새 경합자가 끼어드는 극히 이례적인 상황이다. */
    private static final int MAX_ENQUEUE_ATTEMPTS = 2;

    private static final String ENQUEUE_FAILURE_MESSAGE = "Failed to enqueue dashboard AI job";
    private static final RedisScript<String> ENQUEUE_IF_CAPACITY_SCRIPT = RedisScript.of(
        new ClassPathResource("redis/dashboard-ai-enqueue.lua"),
        String.class
    );
    private static final RedisScript<Long> RELEASE_IN_FLIGHT_SCRIPT = RedisScript.of(
        new ClassPathResource("redis/dashboard-ai-release-inflight.lua"),
        Long.class
    );
    private static final RedisScript<Long> RENEW_IN_FLIGHT_SCRIPT = RedisScript.of(
        new ClassPathResource("redis/dashboard-ai-renew-inflight.lua"),
        Long.class
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

        for (int attempt = 0; attempt < MAX_ENQUEUE_ATTEMPTS; attempt++) {
            UUID jobId = UUID.randomUUID();
            Boolean claimed = redisTemplate.opsForValue().setIfAbsent(inFlightKey, jobId.toString(), IN_FLIGHT_TTL);
            if (Boolean.TRUE.equals(claimed)) {
                try {
                    return doEnqueue(projectId, jobType, jobId, requestedBy);
                } catch (RuntimeException exception) {
                    releaseInFlight(projectId, jobType, jobId.toString());
                    throw exception;
                }
            }

            String existingJobId = redisTemplate.opsForValue().get(inFlightKey);
            if (existingJobId != null) {
                return existingJobId;
            }
            // setIfAbsent 실패와 get 사이에 마커가 사라졌다(TTL 만료 또는 다른 워커의 release) —
            // 아무도 실제로 큐에 넣지 않은 채 마커만 없어진 상태이므로, 새 jobId로 폴백하지 않고
            // 우리가 직접 claim을 다시 시도한다.
        }
        throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
    }

    /** 워커가 작업을 실제로 완료했을 때 호출해 완료 마커를 남기고 in-flight 마커를 지운다.
     * 다음 요청부터 다시 적재될 수 있다. */
    public void markDone(Long projectId, DashboardAiJobType jobType, String jobId) {
        // 완료 마커를 먼저 남긴 뒤 in-flight를 푼다. 순서가 반대면 그 사이에 들어온 상태 조회가
        // "in-flight 없음 + done 없음"을 보고 FAILED로 오보고한다.
        redisTemplate.opsForValue().set(doneKey(projectId, jobType, jobId), "1", DONE_TTL);
        releaseInFlight(projectId, jobType, jobId);
    }

    /** 워커가 작업을 포기(실패)했을 때 호출해 in-flight 마커만 지운다. 완료 마커는 남기지 않으므로
     * jobStatus()는 이 작업을 FAILED로 보고한다. */
    public void releaseInFlight(Long projectId, DashboardAiJobType jobType, String jobId) {
        // 무조건 DEL 하면, IN_FLIGHT_TTL 만료 후 새 작업이 같은 키를 다시 claim한 상태에서
        // 늦게 끝난 이전 워커가 새 작업의 마커까지 지운다 - 반드시 소유권을 확인하고 지운다.
        redisTemplate.execute(RELEASE_IN_FLIGHT_SCRIPT, List.of(inFlightKey(projectId, jobType)), jobId);
    }

    /**
     * 처리 중인 작업의 in-flight 마커 수명을 IN_FLIGHT_TTL만큼 다시 늘린다.
     *
     * <p>TTL은 "워커가 죽어 마커를 못 지우는 경우"를 위한 안전장치이지 작업 시간 상한이 아니다.
     * 그런데 마커는 enqueue() 때 한 번만 설정되므로, 재분석이 TTL(5분)보다 오래 걸리면 아직
     * 돌고 있는 도중에 마커가 사라져 (1) 같은 프로젝트 작업이 중복 적재·실행되고
     * (2) 상태 조회가 실행 중인 작업을 FAILED로 보고한다. 그래서 워커가 처리하는 동안
     * 주기적으로 이 메서드를 호출해 마커를 살려 둔다.
     *
     * <p>소유권을 확인하고 늘린다 - 이미 만료돼 다른 요청이 새 jobId로 다시 claim한 마커를
     * 늦게 끝난 이전 워커가 연장하면 안 된다. 키가 이미 없으면 아무 일도 하지 않는다(되살리지 않음).
     */
    public void renewInFlight(Long projectId, DashboardAiJobType jobType, String jobId) {
        redisTemplate.execute(
            RENEW_IN_FLIGHT_SCRIPT,
            List.of(inFlightKey(projectId, jobType)),
            jobId,
            Long.toString(IN_FLIGHT_TTL.toMillis())
        );
    }

    /** 주어진 jobId가 아직 in-flight 마커의 주인이면 처리 중이다. */
    public boolean isJobActive(Long projectId, DashboardAiJobType jobType, String jobId) {
        String current = redisTemplate.opsForValue().get(inFlightKey(projectId, jobType));
        return jobId.equals(current);
    }

    /** 워커가 이 jobId를 실제로 완료 처리했는지. in-flight 마커의 부재(TTL 만료/재시도 대기 중 포함)만으로는
     * 완료를 뜻하지 않으므로, "완료"는 반드시 이 마커로만 판단해야 한다.
     * 키를 projectId/jobType으로 스코핑해, 다른 프로젝트의 jobId를 넣어 완료 여부를 떠보거나
     * 엉뚱한 프로젝트의 완료 마커에 걸리는 일이 없게 한다. */
    public boolean isJobDone(Long projectId, DashboardAiJobType jobType, String jobId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(doneKey(projectId, jobType, jobId)));
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

    private static String doneKey(Long projectId, DashboardAiJobType jobType, String jobId) {
        return DONE_KEY_PREFIX + projectId + ":" + jobType + ":" + jobId;
    }
}
