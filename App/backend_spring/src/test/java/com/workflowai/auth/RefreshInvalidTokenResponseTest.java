package com.workflowai.auth;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.presence.PresenceService;
import com.workflowai.security.InvalidTokenException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 리프레시 토큰이 거부되는 경로는 만료·위조·"비밀번호 변경 이전 발급" 셋 다 같은
 * {@link InvalidTokenException}으로 수렴한다. 그런데 이 예외에 핸들러가 없어 500이 나가고 있었다.
 *
 * <p>비밀번호 변경 기능이 이 경로를 상시로 밟게 만든다 — 비밀번호를 바꿀 때마다 다른 기기가
 * 정확히 여기로 들어온다. 정상적인 "다시 로그인하세요"가 서버 에러로 보이면 운영 로그가
 * ERROR 스택트레이스로 오염되고, 클라이언트도 재시도할 수 있는 실패로 오해한다.
 */
@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = "workflow.frontend.base-url=http://localhost:5173")
class RefreshInvalidTokenResponseTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private GoogleOAuthService googleOAuthService;
    @MockitoBean private AuthService authService;
    @MockitoBean private TestLoginService testLoginService;
    @MockitoBean private PresenceService presenceService;
    @MockitoBean private AccountRecoveryService accountRecoveryService;
    @MockitoBean private PasswordResetService passwordResetService;
    @MockitoBean private AccountRecoveryRateLimiter rateLimiter;

    /** 재발급에도 레이트리밋이 걸려 있다. 여기서 보려는 건 한도가 아니라 거부 응답이므로 통과시킨다. */
    @org.junit.jupiter.api.BeforeEach
    void allowRateLimiter() {
        when(rateLimiter.tryAcquire(anyString(), anyString(), org.mockito.ArgumentMatchers.anyInt(),
            org.mockito.ArgumentMatchers.any())).thenReturn(true);
    }

    @Test
    void refresh_withRejectedToken_returns401NotServerError() throws Exception {
        when(authService.refresh(anyString()))
            .thenThrow(new InvalidTokenException("유효하지 않은 토큰입니다."));

        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"stale-or-forged\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("INVALID_TOKEN"))
            .andExpect(jsonPath("$.error.message").value("유효하지 않은 토큰입니다."));
    }

    /**
     * JwtService는 거부 사유마다 다른 메시지를 던진다("토큰 타입이 올바르지 않습니다." 등).
     * 예외 메시지를 그대로 흘리면 응답이 사유별로 갈려, 사유를 구분하지 않는다는 전제가 깨진다.
     * 응답 문구는 예외가 뭐라고 하든 하나로 고정한다.
     */
    @Test
    void refresh_rejectionReasonIsNotLeakedThroughTheMessage() throws Exception {
        when(authService.refresh(anyString()))
            .thenThrow(new InvalidTokenException("토큰 타입이 올바르지 않습니다."));

        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"an-access-token-not-a-refresh-one\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("INVALID_TOKEN"))
            .andExpect(jsonPath("$.error.message").value("유효하지 않은 토큰입니다."));
    }
}
