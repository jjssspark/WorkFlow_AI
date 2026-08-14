package com.workflowai.auth;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 계정 복구 엔드포인트용 고정 윈도우 카운터.
 *
 * <p>Redis가 죽었을 때 요청을 막지 않고 통과시킨다 — 레이트 리밋은 부가 방어이고, 이것 때문에
 * 정상 사용자의 계정 복구가 막히면 손해가 더 크다.
 */
@Component
public class AccountRecoveryRateLimiter {
    private static final Logger log = LoggerFactory.getLogger(AccountRecoveryRateLimiter.class);

    private final StringRedisTemplate redisTemplate;

    public AccountRecoveryRateLimiter(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean tryAcquire(String bucket, String key, int limit, Duration window) {
        String redisKey = "ratelimit:" + bucket + ":" + key;
        try {
            Long count = redisTemplate.opsForValue().increment(redisKey);
            if (count == null) {
                return true;
            }
            if (count == 1L) {
                redisTemplate.expire(redisKey, window);
            }
            return count <= limit;
        } catch (org.springframework.dao.DataAccessException e) {
            log.warn("레이트 리밋 확인 실패 - 요청은 통과시킨다: key={}", redisKey, e);
            return true;
        }
    }
}
