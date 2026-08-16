package com.workflowai.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.support.PostgresRedisIntegrationTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

class AccountRecoveryRateLimitApiTest extends PostgresRedisIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @BeforeEach
    void clearCounters() {
        redisTemplate.keys("ratelimit:*").forEach(redisTemplate::delete);
    }

    @AfterEach
    void clearCountersAfter() {
        redisTemplate.keys("ratelimit:*").forEach(redisTemplate::delete);
    }

    @Test
    @DisplayName("같은 이메일로 4번째 재설정 요청은 429")
    void requestReset_fourthAttemptRateLimited() throws Exception {
        String body = "{\"email\":\"ratelimit@example.com\"}";

        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/v1/auth/password-reset/request")
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
        }

        mockMvc.perform(post("/api/v1/auth/password-reset/request")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    /**
     * 재발급은 사용자 행에 공유 잠금을 잡는다. 비밀번호 변경이 배타 잠금을 쥔 동안 재발급이 대기하면
     * 그 요청이 커넥션을 붙든 채 멈춰 있는데, 커넥션 풀이 4개뿐이라 소수의 동시 요청만으로 무관한
     * 사용자까지 커넥션을 못 받는다. 잠금을 도입한 이상 이 엔드포인트에도 상한이 있어야 한다.
     *
     * <p>정상 사용자는 액세스 토큰 만료(30분)마다 한 번 부르므로 이 한도에 닿지 않는다.
     */
    @Test
    @DisplayName("토큰 재발급도 IP 기준으로 막힌다")
    void refresh_rateLimited() throws Exception {
        String body = "{\"refreshToken\":\"not-a-real-token\"}";

        // 토큰이 가짜라 401이지만, 레이트리밋은 토큰 유효성과 무관하게 걸려야 한다.
        for (int i = 0; i < 60; i++) {
            mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON).content(body));
        }

        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    /**
     * 재설정 확인도 사용자 행에 배타 잠금을 잡는다. 요청 단계(password-reset/request)에만 상한이
     * 있고 확인 단계에는 없어서, 토큰 하나만 있으면 잠금을 반복해서 잡을 수 있었다.
     */
    @Test
    @DisplayName("재설정 확인도 IP 기준으로 막힌다")
    void confirmReset_rateLimited() throws Exception {
        String body = "{\"token\":\"not-a-real-token\",\"newPassword\":\"ValidPass!123\"}";

        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                .contentType(MediaType.APPLICATION_JSON).content(body));
        }

        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    @Test
    @DisplayName("아이디 찾기도 IP 기준으로 막힌다")
    void findEmail_rateLimited() throws Exception {
        String body = "{\"name\":\"홍길동\",\"affiliation\":\"컴퓨터공학과\"}";

        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/v1/auth/find-email")
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
        }

        mockMvc.perform(post("/api/v1/auth/find-email")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests());
    }
}
