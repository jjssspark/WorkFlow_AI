package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

class PasswordResetApiTest extends PostgresRedisIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordResetTokenRepository tokenRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Long userId;

    @BeforeEach
    void seed() {
        tokenRepository.deleteAll();
        userRepository.findByEmail("api-reset@example.com").ifPresent(userRepository::delete);
        User user = userRepository.save(new User(
            "api-reset@example.com", "김에이피", "local", "api-reset@example.com",
            passwordEncoder.encode("oldPassword123")));
        userId = user.getId();
    }

    @Test
    @DisplayName("존재하는 계정과 없는 계정의 응답 본문이 완전히 같다")
    void requestReset_responseIdenticalRegardlessOfAccount() throws Exception {
        String existing = mockMvc.perform(post("/api/v1/auth/password-reset/request")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"api-reset@example.com\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        String missing = mockMvc.perform(post("/api/v1/auth/password-reset/request")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"nobody@example.com\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        assertThat(existing).isEqualTo(missing);
    }

    @Test
    @DisplayName("이메일 형식이 아니면 400")
    void requestReset_invalidEmail_rejected() throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-reset/request")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"not-an-email\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("유효한 토큰으로 확인하면 200")
    void confirmReset_valid_ok() throws Exception {
        tokenRepository.save(new PasswordResetToken(
            userId, PasswordResetService.sha256Hex("api-token-1"),
            LocalDateTime.now().plusMinutes(30), null));

        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"api-token-1\",\"newPassword\":\"newPassword123\"}"))
            .andExpect(status().isOk());
    }

    @Test
    @DisplayName("무효한 토큰이면 400과 INVALID_RESET_TOKEN")
    void confirmReset_invalidToken_400() throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"nope\",\"newPassword\":\"newPassword123\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                .jsonPath("$.error.code").value("INVALID_RESET_TOKEN"));
    }

    @Test
    @DisplayName("재설정 후 새 비밀번호로 로그인되고 옛 비밀번호로는 안 된다")
    void confirmReset_thenLogin() throws Exception {
        tokenRepository.save(new PasswordResetToken(
            userId, PasswordResetService.sha256Hex("api-token-2"),
            LocalDateTime.now().plusMinutes(30), null));

        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"api-token-2\",\"newPassword\":\"newPassword123\"}"))
            .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"api-reset@example.com\",\"password\":\"newPassword123\"}"))
            .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"api-reset@example.com\",\"password\":\"oldPassword123\"}"))
            .andExpect(status().isUnauthorized());
    }
}
