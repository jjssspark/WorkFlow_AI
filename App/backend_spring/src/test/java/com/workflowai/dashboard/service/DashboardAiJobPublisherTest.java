package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
        when(redisTemplate.hasKey("dashboard-ai-done:job-1")).thenReturn(true);

        assertThat(newPublisher().isJobDone("job-1")).isTrue();
    }

    @Test
    void isJobDoneReturnsFalseWhenNoDoneMarkerExists() {
        when(redisTemplate.hasKey("dashboard-ai-done:job-1")).thenReturn(false);

        assertThat(newPublisher().isJobDone("job-1")).isFalse();
    }

    @Test
    void markDoneSetsDoneMarkerAndClearsInFlightMarker() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);

        newPublisher().markDone(1L, DashboardAiJobType.DELAY_RISK, "job-1");

        verify(valueOperations).set(eq("dashboard-ai-done:job-1"), eq("1"), any(Duration.class));
        verify(redisTemplate).delete("dashboard-ai-inflight:1:DELAY_RISK");
    }
}
