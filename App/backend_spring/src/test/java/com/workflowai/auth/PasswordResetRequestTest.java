package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PasswordResetRequestTest extends PostgresRedisIntegrationTest {

    @Autowired
    private PasswordResetService passwordResetService;

    @Autowired
    private PasswordResetTokenRepository tokenRepository;

    @Autowired
    private UserRepository userRepository;

    @BeforeEach
    void seed() {
        tokenRepository.deleteAll();
        userRepository.findByEmail("local-reset@example.com").ifPresent(userRepository::delete);
        userRepository.findByEmail("google-reset@example.com").ifPresent(userRepository::delete);
        userRepository.save(new User(
            "local-reset@example.com", "김로컬", "local", "local-reset@example.com", "hash"));
        userRepository.save(new User(
            "google-reset@example.com", "김구글", "google", "google-sub-1"));
    }

    @Test
    @DisplayName("로컬 계정이면 토큰이 하나 생긴다")
    void requestReset_localAccount_createsToken() {
        passwordResetService.requestReset("local-reset@example.com", "127.0.0.1");

        assertThat(tokenRepository.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("Google 계정이면 토큰을 만들지 않는다")
    void requestReset_googleAccount_noToken() {
        passwordResetService.requestReset("google-reset@example.com", "127.0.0.1");

        assertThat(tokenRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("없는 계정이어도 예외를 던지지 않고 토큰도 만들지 않는다")
    void requestReset_unknownAccount_silent() {
        passwordResetService.requestReset("nobody@example.com", "127.0.0.1");

        assertThat(tokenRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("저장된 것은 원문이 아니라 64자 해시다")
    void requestReset_storesHashNotPlaintext() {
        passwordResetService.requestReset("local-reset@example.com", "127.0.0.1");

        String stored = tokenRepository.findAll().get(0).getTokenHash();
        assertThat(stored).hasSize(64).matches("[0-9a-f]{64}");
    }

    @Test
    @DisplayName("이메일 대소문자와 공백을 무시한다")
    void requestReset_normalizesEmail() {
        passwordResetService.requestReset("  LOCAL-RESET@EXAMPLE.COM ", "127.0.0.1");

        assertThat(tokenRepository.findAll()).hasSize(1);
    }
}
