package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

@ExtendWith(MockitoExtension.class)
class DashboardAiJobPublisherTest {

    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOperations;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private DashboardAiJobPublisher newPublisher() {
        return new DashboardAiJobPublisher(redisTemplate, objectMapper);
    }

    @Test
    void enqueueReturnsExistingJobIdWhenAnotherJobIsAlreadyInFlight() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(false);
        when(valueOperations.get(anyString())).thenReturn("existing-job-id");

        String result = newPublisher().enqueue(1L, DashboardAiJobType.DELAY_RISK, 5L);

        assertThat(result).isEqualTo("existing-job-id");
        verify(redisTemplate, never()).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void enqueueRetriesInsteadOfReturningUnqueuedJobIdWhenInFlightMarkerVanishesDuringRace() {
        // setIfAbsent가 실패했는데 뒤이은 get()이 null을 반환하는 경우 - 다른 요청이 setIfAbsent에는
        // 성공했지만 그 사이 TTL 만료/release로 마커가 사라진 순간의 경합이다. 이때 새 jobId를 그냥
        // 반환하면(예전 버그) 아무도 큐에 넣지 않은 jobId를 돌려주게 된다 - 두 번째 시도에서 직접
        // claim에 성공해 실제로 큐에 적재해야 한다.
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(false, true);
        when(valueOperations.get(anyString())).thenReturn(null);
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenReturn("1753257600000-0");

        String result = newPublisher().enqueue(1L, DashboardAiJobType.DELAY_RISK, 5L);

        assertThat(result).isNotBlank();
        verify(redisTemplate, times(1)).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void enqueueSucceedsImmediatelyWhenNoJobIsInFlight() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(true);
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenReturn("1753257600000-0");

        String result = newPublisher().enqueue(1L, DashboardAiJobType.DELAY_RISK, 5L);

        assertThat(result).isNotBlank();
        verify(redisTemplate, times(1)).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void isJobDoneReflectsDoneMarkerPresence() {
        when(redisTemplate.hasKey("dashboard-ai-done:1:DELAY_RISK:job-1")).thenReturn(true);

        assertThat(newPublisher().isJobDone(1L, DashboardAiJobType.DELAY_RISK, "job-1")).isTrue();
    }

    @Test
    void isJobDoneReturnsFalseWhenNoDoneMarkerExists() {
        when(redisTemplate.hasKey("dashboard-ai-done:1:DELAY_RISK:job-1")).thenReturn(false);

        assertThat(newPublisher().isJobDone(1L, DashboardAiJobType.DELAY_RISK, "job-1")).isFalse();
    }

    @Test
    void doneMarkerIsScopedToProjectAndJobType() {
        // 완료 마커가 jobId만으로 만들어지면 다른 프로젝트/작업 종류의 조회가 같은 키에 걸린다.
        newPublisher().isJobDone(2L, DashboardAiJobType.WORKLOAD_SCORE, "job-1");

        verify(redisTemplate).hasKey("dashboard-ai-done:2:WORKLOAD_SCORE:job-1");
        verify(redisTemplate, never()).hasKey("dashboard-ai-done:job-1");
    }

    @Test
    void markDoneSetsScopedDoneMarkerThenReleasesInFlightWithOwnershipCheck() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);

        newPublisher().markDone(1L, DashboardAiJobType.DELAY_RISK, "job-1");

        // 완료 마커를 먼저 남기고 in-flight를 푼다. 순서가 반대면 그 틈의 상태 조회가 FAILED로 샌다.
        InOrder inOrder = inOrder(valueOperations, redisTemplate);
        inOrder.verify(valueOperations)
            .set(eq("dashboard-ai-done:1:DELAY_RISK:job-1"), eq("1"), any(Duration.class));
        inOrder.verify(redisTemplate).execute(
            any(RedisScript.class), eq(List.of("dashboard-ai-inflight:1:DELAY_RISK")), eq("job-1")
        );
        // 무조건 DEL은 남의 마커를 지운다 - 반드시 소유권 확인 스크립트를 거쳐야 한다.
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void renewInFlightExtendsTheMarkerThroughOwnershipCheckedScript() {
        // 처리 중 마커를 갱신하지 않으면 IN_FLIGHT_TTL(5분)을 넘기는 작업이 아직 돌고 있는데도
        // 중복 방지가 풀린다. 갱신도 소유권을 확인해야 남의 마커 수명을 늘리지 않는다.
        newPublisher().renewInFlight(1L, DashboardAiJobType.DELAY_RISK, "job-1");

        verify(redisTemplate).execute(
            any(RedisScript.class),
            eq(List.of("dashboard-ai-inflight:1:DELAY_RISK")),
            eq("job-1"),
            eq(Long.toString(Duration.ofMinutes(5).toMillis()))
        );
    }

    @Test
    void releaseInFlightGoesThroughOwnershipCheckedScript() {
        newPublisher().releaseInFlight(1L, DashboardAiJobType.WORKLOAD_SCORE, "job-9");

        verify(redisTemplate).execute(
            any(RedisScript.class), eq(List.of("dashboard-ai-inflight:1:WORKLOAD_SCORE")), eq("job-9")
        );
        verify(redisTemplate, never()).delete(anyString());
    }
}
