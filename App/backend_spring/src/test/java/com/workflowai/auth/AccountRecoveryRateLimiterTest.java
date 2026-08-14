package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.support.PostgresRedisIntegrationTest;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;

class AccountRecoveryRateLimiterTest extends PostgresRedisIntegrationTest {

    @Autowired
    private AccountRecoveryRateLimiter rateLimiter;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Test
    @DisplayName("한도까지는 통과하고 그 다음부터 막는다")
    void tryAcquire_blocksAfterLimit() {
        redisTemplate.delete("ratelimit:test-bucket:key-1");

        assertThat(rateLimiter.tryAcquire("test-bucket", "key-1", 3, Duration.ofMinutes(5))).isTrue();
        assertThat(rateLimiter.tryAcquire("test-bucket", "key-1", 3, Duration.ofMinutes(5))).isTrue();
        assertThat(rateLimiter.tryAcquire("test-bucket", "key-1", 3, Duration.ofMinutes(5))).isTrue();
        assertThat(rateLimiter.tryAcquire("test-bucket", "key-1", 3, Duration.ofMinutes(5))).isFalse();
    }

    @Test
    @DisplayName("키가 다르면 서로 영향을 주지 않는다")
    void tryAcquire_isolatedByKey() {
        redisTemplate.delete("ratelimit:test-bucket:key-2");
        redisTemplate.delete("ratelimit:test-bucket:key-3");

        assertThat(rateLimiter.tryAcquire("test-bucket", "key-2", 1, Duration.ofMinutes(5))).isTrue();
        assertThat(rateLimiter.tryAcquire("test-bucket", "key-2", 1, Duration.ofMinutes(5))).isFalse();
        assertThat(rateLimiter.tryAcquire("test-bucket", "key-3", 1, Duration.ofMinutes(5))).isTrue();
    }

    @Test
    @DisplayName("첫 요청에 TTL이 걸린다")
    void tryAcquire_setsTtlOnFirstHit() {
        redisTemplate.delete("ratelimit:test-bucket:key-4");

        rateLimiter.tryAcquire("test-bucket", "key-4", 3, Duration.ofMinutes(5));

        Long ttl = redisTemplate.getExpire("ratelimit:test-bucket:key-4");
        assertThat(ttl).isNotNull().isPositive();
    }

    @Test
    @DisplayName("TTL 없이 남아있는 키를 만나면 자가 복구로 TTL을 다시 건다")
    void tryAcquire_selfHealsMissingTtl() {
        redisTemplate.delete("ratelimit:test-bucket:key-5");
        redisTemplate.opsForValue().set("ratelimit:test-bucket:key-5", "5");

        rateLimiter.tryAcquire("test-bucket", "key-5", 3, Duration.ofMinutes(5));

        Long ttl = redisTemplate.getExpire("ratelimit:test-bucket:key-5");
        assertThat(ttl).isNotNull().isPositive();
    }
}
