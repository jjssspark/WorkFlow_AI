package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workflowai.security.InvalidTokenException;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

class PasswordResetConfirmTest extends PostgresRedisIntegrationTest {

    @Autowired
    private PasswordResetService passwordResetService;

    @Autowired
    private PasswordResetTokenRepository tokenRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private AuthService authService;

    @Autowired
    private JwtService jwtService;

    private Long userId;

    @BeforeEach
    void seed() {
        tokenRepository.deleteAll();
        userRepository.findByEmail("confirm@example.com").ifPresent(userRepository::delete);
        User user = userRepository.save(new User(
            "confirm@example.com", "김확인", "local", "confirm@example.com",
            passwordEncoder.encode("oldPassword123")));
        userId = user.getId();
    }

    private void saveToken(String rawToken, LocalDateTime expiresAt) {
        tokenRepository.save(new PasswordResetToken(
            userId, PasswordResetService.sha256Hex(rawToken), expiresAt, null));
    }

    @Test
    @DisplayName("유효한 토큰이면 비밀번호가 바뀐다")
    void confirmReset_validToken_changesPassword() {
        saveToken("raw-token-1", LocalDateTime.now().plusMinutes(30));

        passwordResetService.confirmReset("raw-token-1", "newPassword123");

        User updated = userRepository.findById(userId).orElseThrow();
        assertThat(passwordEncoder.matches("newPassword123", updated.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches("oldPassword123", updated.getPasswordHash())).isFalse();
    }

    @Test
    @DisplayName("비밀번호 변경 성공 시 passwordChangedAt이 세팅된다")
    void confirmReset_validToken_setsPasswordChangedAt() {
        User before = userRepository.findById(userId).orElseThrow();
        assertThat(before.getPasswordChangedAt()).isNull();

        LocalDateTime beforeConfirm = LocalDateTime.now();
        saveToken("raw-token-8", LocalDateTime.now().plusMinutes(30));

        passwordResetService.confirmReset("raw-token-8", "newPassword123");

        User updated = userRepository.findById(userId).orElseThrow();
        assertThat(updated.getPasswordChangedAt()).isNotNull();
        assertThat(updated.getPasswordChangedAt()).isAfterOrEqualTo(beforeConfirm);
    }

    @Test
    @DisplayName("[E2E] 재설정으로 비밀번호를 바꾸면 그 이전에 발급된 리프레시 토큰은 더 이상 통하지 않는다")
    void confirmReset_invalidatesRefreshTokensIssuedBeforeReset() {
        User user = userRepository.findById(userId).orElseThrow();
        String oldRefreshToken = jwtService.issueRefreshToken(user);

        saveToken("raw-token-e2e", LocalDateTime.now().plusMinutes(30));
        passwordResetService.confirmReset("raw-token-e2e", "newPassword123");

        assertThatThrownBy(() -> authService.refresh(oldRefreshToken))
            .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    @DisplayName("사용된 토큰은 다시 쓸 수 없다")
    void confirmReset_reusedToken_rejected() {
        saveToken("raw-token-2", LocalDateTime.now().plusMinutes(30));
        passwordResetService.confirmReset("raw-token-2", "newPassword123");

        assertThatThrownBy(() -> passwordResetService.confirmReset("raw-token-2", "another123"))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    @Test
    @DisplayName("만료된 토큰은 거부한다")
    void confirmReset_expiredToken_rejected() {
        saveToken("raw-token-3", LocalDateTime.now().minusMinutes(1));

        assertThatThrownBy(() -> passwordResetService.confirmReset("raw-token-3", "newPassword123"))
            .isInstanceOf(InvalidResetTokenException.class);

        User unchanged = userRepository.findById(userId).orElseThrow();
        assertThat(passwordEncoder.matches("oldPassword123", unchanged.getPasswordHash())).isTrue();
    }

    @Test
    @DisplayName("존재하지 않는 토큰은 거부한다")
    void confirmReset_unknownToken_rejected() {
        assertThatThrownBy(() -> passwordResetService.confirmReset("no-such-token", "newPassword123"))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    @Test
    @DisplayName("성공하면 같은 사용자의 다른 미사용 토큰도 함께 닫힌다")
    void confirmReset_invalidatesSiblingTokens() {
        saveToken("raw-token-4", LocalDateTime.now().plusMinutes(30));
        saveToken("raw-token-5", LocalDateTime.now().plusMinutes(30));

        passwordResetService.confirmReset("raw-token-4", "newPassword123");

        assertThat(tokenRepository.findAll()).allSatisfy(t -> assertThat(t.getUsedAt()).isNotNull());
    }

    @Test
    @DisplayName("8자 미만 비밀번호는 거부하고 토큰을 소모하지 않는다")
    void confirmReset_shortPassword_rejectedAndTokenSurvives() {
        saveToken("raw-token-6", LocalDateTime.now().plusMinutes(30));

        assertThatThrownBy(() -> passwordResetService.confirmReset("raw-token-6", "short"))
            .isInstanceOf(InvalidSignupInputException.class);

        assertThat(tokenRepository.findByTokenHash(PasswordResetService.sha256Hex("raw-token-6"))
            .orElseThrow().getUsedAt()).isNull();
    }

    /**
     * 글자 수만 세면 한글 25자(75바이트)가 정책을 통과해 encode()까지 간다. BCrypt는 72바이트 초과를
     * 자르지 않고 던지므로 500이 나는데, 그 시점엔 이미 토큰이 소모된 뒤라 사용자는 메일을 다시 받아야
     * 한다. "정책 위반은 토큰을 소모하기 전에 막는다"는 약속이 바이트 위반에서만 깨져 있었다.
     */
    @Test
    @DisplayName("72바이트를 넘는 비밀번호는 거부하고 토큰을 소모하지 않는다")
    void confirmReset_passwordOver72Bytes_rejectedAndTokenSurvives() {
        saveToken("raw-token-8", LocalDateTime.now().plusMinutes(30));

        assertThatThrownBy(() -> passwordResetService.confirmReset("raw-token-8", "가".repeat(25)))
            .isInstanceOf(InvalidSignupInputException.class);

        assertThat(tokenRepository.findByTokenHash(PasswordResetService.sha256Hex("raw-token-8"))
            .orElseThrow().getUsedAt()).isNull();
    }

    @Test
    @DisplayName("한글 24자(정확히 72바이트)는 재설정에 쓸 수 있다")
    void confirmReset_passwordExactly72Bytes_isAccepted() {
        saveToken("raw-token-9", LocalDateTime.now().plusMinutes(30));
        String korean24 = "가".repeat(24);

        passwordResetService.confirmReset("raw-token-9", korean24);

        assertThat(passwordEncoder.matches(korean24, userRepository.findById(userId)
            .orElseThrow().getPasswordHash())).isTrue();
    }

    @Test
    @DisplayName("같은 토큰을 동시에 소비하려 하면 한쪽만 성공한다")
    void consumeIfUnused_sameTokenTwice_onlyFirstClaimsIt() {
        saveToken("raw-token-7", LocalDateTime.now().plusMinutes(30));
        PasswordResetToken token = tokenRepository
            .findByTokenHash(PasswordResetService.sha256Hex("raw-token-7"))
            .orElseThrow();

        int firstClaim = tokenRepository.consumeIfUnused(token.getId());
        int secondClaim = tokenRepository.consumeIfUnused(token.getId());

        assertThat(firstClaim).isEqualTo(1);
        assertThat(secondClaim).isEqualTo(0);
    }
}
