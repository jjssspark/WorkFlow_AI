package com.workflowai.auth;

import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
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

    // INCR 이후 PEXPIRE가 별도 왕복이면 그 사이 프로세스가 죽었을 때 TTL 없는 키가 남는다.
    // 하나의 Lua 스크립트로 묶어 원자화하고, TTL이 없는 키를 만나면 자가 복구한다.
    private static final DefaultRedisScript<Long> INCREMENT_AND_EXPIRE_SCRIPT;

    static {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
        script.setScriptText(
                "local c = redis.call('INCR', KEYS[1])\n"
                        + "if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then\n"
                        + "  redis.call('PEXPIRE', KEYS[1], ARGV[1])\n"
                        + "end\n"
                        + "return c");
        script.setResultType(Long.class);
        INCREMENT_AND_EXPIRE_SCRIPT = script;
    }

    private final StringRedisTemplate redisTemplate;

    public AccountRecoveryRateLimiter(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean tryAcquire(String bucket, String key, int limit, Duration window) {
        String redisKey = "ratelimit:" + bucket + ":" + key;
        try {
            Long count =
                    redisTemplate.execute(
                            INCREMENT_AND_EXPIRE_SCRIPT,
                            List.of(redisKey),
                            String.valueOf(window.toMillis()));
            if (count == null) {
                return true;
            }
            return count <= limit;
        } catch (org.springframework.dao.DataAccessException e) {
            log.warn("레이트 리밋 확인 실패 - 요청은 통과시킨다: key={}", redisKey, e);
            return true;
        }
    }
}
