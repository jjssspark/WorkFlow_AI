package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

@ExtendWith(MockitoExtension.class)
class DashboardWorkloadScoreCacheTest {

    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOperations;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private DashboardWorkloadScoreCache newCache() {
        return new DashboardWorkloadScoreCache(redisTemplate, objectMapper);
    }

    private WorkloadScoreResponseDto sample() {
        return new WorkloadScoreResponseDto("1.0", 1L, "db", "MAD", List.of(), null, 0.5, null);
    }

    @Test
    void putStampsCalculatedAtAndPersistsItWithTheValue() throws Exception {
        // TTL이 30일이라, 계산 시각이 값에 함께 저장되지 않으면 화면이 한 달 가까이 묵은 점수를
        // 방금 계산한 값처럼 보여주게 된다.
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        Instant before = Instant.now();

        WorkloadScoreResponseDto stamped = newCache().put(1L, sample());

        assertThat(stamped.calculated_at()).isNotNull();
        Instant recorded = Instant.parse(stamped.calculated_at());
        assertThat(recorded).isBetween(before, Instant.now());

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("dashboard:workload-score:1"), json.capture(), any(Duration.class));
        WorkloadScoreResponseDto persisted =
            objectMapper.readValue(json.getValue(), WorkloadScoreResponseDto.class);
        assertThat(persisted.calculated_at()).isEqualTo(stamped.calculated_at());
    }

    @Test
    void getReadsBackTheStoredCalculatedAt() throws Exception {
        WorkloadScoreResponseDto stored = sample().withCalculatedAt("2026-07-01T09:00:00Z");
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("dashboard:workload-score:1"))
            .thenReturn(objectMapper.writeValueAsString(stored));

        Optional<WorkloadScoreResponseDto> result = newCache().get(1L);

        assertThat(result).isPresent();
        assertThat(result.get().calculated_at()).isEqualTo("2026-07-01T09:00:00Z");
    }

    @Test
    void getReturnsEmptyOnCorruptedCacheEntry() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("dashboard:workload-score:1")).thenReturn("not json");

        assertThat(newCache().get(1L)).isEmpty();
    }

    @Test
    void getReturnsEmptyForPreThreeAxisSchemaCacheEntry() {
        // 리뷰 지적: 3축 리팩터링 이전(anomaly_type 단일 문자열 + difficulty_avg_rel) 스키마로
        // 캐시된 JSON이 TTL 30일 동안 Redis에 남아있다가, 새 WorkloadScoreMemberDto record로
        // 역직렬화되면 어떻게 되는지 확인한다. anomaly_type/difficulty_avg_rel은 신 스키마의
        // known property 목록(anomaly_types/difficulty_score/workload_score/allocation_score
        // 등)에 없으므로 Jackson이 UnrecognizedPropertyException을 던지고, get()의 catch절이
        // 이를 잡아 캐시 미스(Optional.empty())로 처리해야 한다. 이게 깨지면 anomaly_types가
        // null인 DTO가 그대로 프론트로 나가 WorkloadPage.tsx의 anomalyTypes.includes() 호출이
        // 크래시할 수 있다.
        String legacySchemaJson = """
            {
              "schema_version": "0.9",
              "project_id": 1,
              "source": "db",
              "method": "Isolation Forest",
              "members": [
                {
                  "assignee_id": "1",
                  "task_count_total": 5,
                  "completion_rate": 0.5,
                  "overload_score": 10.0,
                  "is_anomaly": false,
                  "anomaly_type": "정상",
                  "difficulty_avg_rel": 1.0,
                  "task_count_active_rel": 1.0,
                  "overdue_count": 0
                }
              ],
              "note": null,
              "team_mean_completion": 0.5,
              "calculated_at": "2026-07-01T00:00:00Z"
            }
            """;
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("dashboard:workload-score:1")).thenReturn(legacySchemaJson);

        assertThat(newCache().get(1L)).isEmpty();
    }
}
