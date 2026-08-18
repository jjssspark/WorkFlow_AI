package com.workflowai.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.comment.PersonalCommentRepository;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.UserRepository;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(MeController.class)
@AutoConfigureMockMvc(addFilters = false)
class MeControllerChangePasswordTest {

    private static final long USER_ID = 7L;

    @Autowired private MockMvc mockMvc;

    @MockitoBean private UserRepository userRepository;
    @MockitoBean private ProjectMemberRepository projectMemberRepository;
    @MockitoBean private ProjectRepository projectRepository;
    @MockitoBean private ProjectService projectService;
    @MockitoBean private S3StorageClient storageClient;
    @MockitoBean private PersonalCommentRepository personalCommentRepository;
    @MockitoBean private AuthService authService;
    @MockitoBean private AccountRecoveryRateLimiter rateLimiter;

    @BeforeEach
    void authenticate() {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(USER_ID, "member@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private String body(String currentPassword, String newPassword) {
        return "{\"currentPassword\":\"" + currentPassword + "\",\"newPassword\":\"" + newPassword + "\"}";
    }

    private void allowRateLimit() {
        when(rateLimiter.tryAcquire(anyString(), anyString(), anyInt(), any(Duration.class))).thenReturn(true);
    }

    @Test
    void changePassword_success_returnsFreshTokens() throws Exception {
        allowRateLimit();
        when(authService.changePassword(USER_ID, "current-pw-1234", "new-password-1234"))
            .thenReturn(new AuthTokenResponse("fresh-access", "fresh-refresh", 1800L, null));

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("current-pw-1234", "new-password-1234")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").value("fresh-access"))
            .andExpect(jsonPath("$.data.refreshToken").value("fresh-refresh"));
    }

    @Test
    void changePassword_usesTheAuthenticatedUserNotARequestField() throws Exception {
        allowRateLimit();
        when(authService.changePassword(eq(USER_ID), anyString(), anyString()))
            .thenReturn(new AuthTokenResponse("a", "r", 1800L, null));

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("current-pw-1234", "new-password-1234")))
            .andExpect(status().isOk());

        // 대상 계정은 인증 주체에서만 나와야 한다. 요청 본문으로 남의 계정을 지정할 수 있으면 안 된다.
        verify(authService).changePassword(eq(USER_ID), anyString(), anyString());
    }

    /**
     * 401이 아니라 400이어야 한다. 프론트의 apiFetch는 401을 받으면 토큰 재발급 후 요청을 한 번 더
     * 보내는데(apiClient.ts), 그러면 (1) 사용자에게 "인증이 만료되었습니다"라는 엉뚱한 문구가 뜨고
     * (2) 한 번의 오타가 레이트 리밋 카운터를 두 번 깎는다. 이 경로의 호출자는 이미 인증된 상태이고
     * 잘못된 것은 본문 값이므로 400이 의미상으로도 맞다.
     */
    @Test
    void changePassword_wrongCurrentPassword_returns400NotUnauthorized() throws Exception {
        allowRateLimit();
        when(authService.changePassword(eq(USER_ID), anyString(), anyString()))
            .thenThrow(new InvalidCredentialsException("현재 비밀번호가 올바르지 않습니다."));

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("wrong-password", "new-password-1234")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"))
            .andExpect(jsonPath("$.error.message").value("현재 비밀번호가 올바르지 않습니다."));
    }

    @Test
    void changePassword_googleAccount_returns400() throws Exception {
        allowRateLimit();
        when(authService.changePassword(eq(USER_ID), anyString(), anyString()))
            .thenThrow(new GoogleAccountRequiredException());

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("current-pw-1234", "new-password-1234")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("GOOGLE_ACCOUNT_REQUIRED"));
    }

    @Test
    void changePassword_policyViolation_returns400() throws Exception {
        allowRateLimit();
        when(authService.changePassword(eq(USER_ID), anyString(), anyString()))
            .thenThrow(new InvalidSignupInputException("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요."));

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("current-pw-1234", "current-pw-1234")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_SIGNUP_INPUT"));
    }

    @Test
    void changePassword_rateLimited_returns429AndNeverReachesTheService() throws Exception {
        when(rateLimiter.tryAcquire(anyString(), anyString(), anyInt(), any(Duration.class))).thenReturn(false);

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("wrong-password", "new-password-1234")))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));

        // 레이트 리밋은 bcrypt 비교 앞에서 막아야 의미가 있다.
        verify(authService, never()).changePassword(any(), anyString(), anyString());
    }

    @Test
    void changePassword_rateLimitBucketIsKeyedByUser() throws Exception {
        allowRateLimit();
        when(authService.changePassword(eq(USER_ID), anyString(), anyString()))
            .thenReturn(new AuthTokenResponse("a", "r", 1800L, null));

        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("current-pw-1234", "new-password-1234")))
            .andExpect(status().isOk());

        verify(rateLimiter).tryAcquire(eq("password-change"), eq(String.valueOf(USER_ID)), anyInt(), any(Duration.class));
    }

    @Test
    void changePassword_oversizedCurrentPassword_isRejectedBeforeBcrypt() throws Exception {
        // bcrypt에 임의 크기 입력이 그대로 넘어가면 안 된다. LoginRequest도 같은 이유로 128자를 건다.
        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("a".repeat(129), "new-password-1234")))
            .andExpect(status().isBadRequest());

        verify(authService, never()).changePassword(any(), anyString(), anyString());
    }

    @Test
    void changePassword_blankCurrentPassword_returns400() throws Exception {
        mockMvc.perform(put("/api/v1/me/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("", "new-password-1234")))
            .andExpect(status().isBadRequest());
    }
}
