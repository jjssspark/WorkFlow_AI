package com.workflowai.dashboard.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * ml_workload_score(FastAPI) 라이브 조회 결과를 프로젝트별로 Redis에 캐싱한다.
 * 지연 위험도와 달리 편중 점수는 DB(ml_predictions)에 쌓지 않는 라이브 계산 값이므로,
 * "마지막으로 성공한 계산 결과"를 여기 보관해두고 FastAPI가 느리거나 내려가 있어도
 * 그 값으로 계속 서비스한다.
 */
@Component
public class DashboardWorkloadScoreCache {
    private static final Logger log = LoggerFactory.getLogger(DashboardWorkloadScoreCache.class);
    private static final String KEY_PREFIX = "dashboard:workload-score:";
    // 캐시일 뿐 영구 저장소가 아니므로, 방치된 프로젝트의 값이 Redis에 무한히 남지 않도록 여유 있게 만료시킨다.
    private static final Duration TTL = Duration.ofDays(30);

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public DashboardWorkloadScoreCache(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<WorkloadScoreResponseDto> get(Long projectId) {
        String json = redisTemplate.opsForValue().get(key(projectId));
        if (json == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(json, WorkloadScoreResponseDto.class));
        } catch (JsonProcessingException exception) {
            log.warn("업무 편중 점수 캐시 역직렬화 실패. projectId={}", projectId, exception);
            return Optional.empty();
        }
    }

    /** 계산 시각을 값 안에 함께 박아 저장한다. TTL이 30일이라 화면이 "언제 기준 값인지" 알지
     * 못하면 한 달 가까이 묵은 점수를 방금 계산한 값처럼 보여주게 된다.
     * @return 계산 시각이 채워진 DTO. 호출부는 캐시에 넣은 것과 같은 값을 그대로 응답에 쓴다. */
    public WorkloadScoreResponseDto put(Long projectId, WorkloadScoreResponseDto value) {
        WorkloadScoreResponseDto stamped = value.withCalculatedAt(Instant.now().toString());
        try {
            redisTemplate.opsForValue().set(key(projectId), objectMapper.writeValueAsString(stamped), TTL);
        } catch (JsonProcessingException exception) {
            log.warn("업무 편중 점수 캐시 저장 실패. projectId={}", projectId, exception);
        }
        return stamped;
    }

    private static String key(Long projectId) {
        return KEY_PREFIX + projectId;
    }
}
