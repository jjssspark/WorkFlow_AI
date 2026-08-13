package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PasswordResetTokenRepositoryTest extends PostgresRedisIntegrationTest {

    @Autowired
    private PasswordResetTokenRepository tokenRepository;

    @Autowired
    private UserRepository userRepository;

    private Long userId;

    @BeforeEach
    void seed() {
        // 컨테이너를 여러 테스트 메서드가 공유하므로(PostgresRedisIntegrationTest 참고) 같은 이메일로
        // 재삽입하기 전에 이전 실행분을 지운다.
        userRepository.findByEmail("reset-repo@example.com").ifPresent(userRepository::delete);
        User user = userRepository.save(
            new User("reset-repo@example.com", "김재설", "local", "reset-repo@example.com", "hash")
        );
        userId = user.getId();
        tokenRepository.deleteAll();
    }

    @Test
    @DisplayName("해시로 토큰을 찾는다")
    void findByTokenHash() {
        tokenRepository.save(new PasswordResetToken(
            userId, "a".repeat(64), LocalDateTime.now().plusMinutes(30), "127.0.0.1"
        ));

        assertThat(tokenRepository.findByTokenHash("a".repeat(64))).isPresent();
        assertThat(tokenRepository.findByTokenHash("b".repeat(64))).isEmpty();
    }

    @Test
    @DisplayName("사용자의 미사용 토큰을 한 번에 무효화한다")
    void invalidateAllUnusedByUserId() {
        tokenRepository.save(new PasswordResetToken(
            userId, "c".repeat(64), LocalDateTime.now().plusMinutes(30), null));
        tokenRepository.save(new PasswordResetToken(
            userId, "d".repeat(64), LocalDateTime.now().plusMinutes(30), null));

        int affected = tokenRepository.invalidateAllUnusedByUserId(userId);

        assertThat(affected).isEqualTo(2);
        assertThat(tokenRepository.findByTokenHash("c".repeat(64)).orElseThrow().getUsedAt()).isNotNull();
        assertThat(tokenRepository.findByTokenHash("d".repeat(64)).orElseThrow().getUsedAt()).isNotNull();
    }

    @Test
    @DisplayName("이미 사용된 토큰은 다시 세지 않는다")
    void invalidateAllUnusedByUserId_skipsUsed() {
        PasswordResetToken used = tokenRepository.save(new PasswordResetToken(
            userId, "e".repeat(64), LocalDateTime.now().plusMinutes(30), null));
        used.markUsed();
        tokenRepository.saveAndFlush(used);

        assertThat(tokenRepository.invalidateAllUnusedByUserId(userId)).isZero();
    }
}
