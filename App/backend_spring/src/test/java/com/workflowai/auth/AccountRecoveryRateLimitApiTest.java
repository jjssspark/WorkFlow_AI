package com.workflowai.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.support.PostgresRedisIntegrationTest;
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
