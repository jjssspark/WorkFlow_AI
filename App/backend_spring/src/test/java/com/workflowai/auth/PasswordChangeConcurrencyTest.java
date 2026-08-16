package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workflowai.security.InvalidTokenException;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비밀번호 변경·재설정이 "다른 기기 세션을 끊는다"고 약속하는데, 그 약속이 원자적인지 본다.
 *
 * <p>리프레시 토큰은 서버에 저장되지 않는다. 대신 {@code passwordChangedAt}보다 이전에 발급된
 * 토큰을 거부하는 방식으로 폐기를 흉내낸다. 이 방식은 "언제로 기록됐는가"와 "언제 커밋됐는가"가
 * 벌어지는 만큼 창이 열린다 — 그 사이에 도착한 재발급 요청은 아직 옛 {@code passwordChangedAt}을
 * 읽으므로 통과하고, 그렇게 만들어진 토큰은 기준 시각보다 <em>뒤</em>라서 변경 후에도 살아남는다.
 * 탈취된 토큰을 반복 호출하는 공격자에게는 이 창이 폐기를 통째로 무력화하는 구멍이 된다.
 *
 * <p>테스트가 직접 트랜잭션을 열고 그 안에서 서비스를 호출한다. 서비스는 REQUIRED라 이 트랜잭션에
 * 합류하므로, 커밋 시점을 테스트가 쥔 채로 "커밋 전"에 도착한 재발급을 재현할 수 있다. 대기 시간에
 * 기대는 방식이 아니다.
 *
 * <p>다만 1.1초 대기 하나는 필요하다. {@code iat}은 JWT 스펙상 초 단위라, 기준 시각과 같은 초에
 * 발급된 토큰은 경계 규칙(&lt;=)이 이미 거부한다. 초를 넘겨야 "살아남는 토큰"이 실제로 만들어진다.
 */
@org.springframework.test.context.TestPropertySource(properties = "workflow.db.lock-timeout=1s")
class PasswordChangeConcurrencyTest extends PostgresRedisIntegrationTest {

    private static final String OLD_PASSWORD = "OldPassword!123";
    private static final String NEW_PASSWORD = "NewPassword!456";

    @Autowired private AuthService authService;
    @Autowired private PasswordResetService passwordResetService;
    @Autowired private PasswordResetTokenRepository tokenRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JwtService jwtService;
    @Autowired private PlatformTransactionManager transactionManager;

    private User seedUser(String email) {
        userRepository.findByEmail(email).ifPresent(userRepository::delete);
        return userRepository.saveAndFlush(new User(
            email, "동시성 검증", "local", email, passwordEncoder.encode(OLD_PASSWORD)));
    }

    /** 거부되면 null. 공격자 입장에서 "쓸 수 있는 토큰이 나왔는가"만 본다. */
    private AuthTokenResponse tryRefresh(String refreshToken) {
        try {
            return authService.refresh(refreshToken);
        } catch (InvalidTokenException e) {
            return null;
        }
    }

    /**
     * 변경 트랜잭션이 아직 커밋되지 않은 동안 다른 스레드가 옛 토큰으로 재발급을 시도한다.
     * 잠금이 없으면 그 스레드는 옛 {@code passwordChangedAt}을 읽고 통과해, 기준 시각보다 뒤에
     * 발급된 토큰을 손에 넣는다. 그 토큰은 변경이 끝난 뒤에도 계속 쓰인다.
     */
    private AuthTokenResponse mintDuringUncommittedChange(Runnable changeInsideTransaction, String oldRefreshToken)
        throws InterruptedException {
        AtomicReference<AuthTokenResponse> minted = new AtomicReference<>();
        AtomicReference<Thread> attacker = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            changeInsideTransaction.run();
            try {
                // 기준 시각과 다른 초에 발급되게 한다. 같은 초면 경계 규칙이 이미 거부한다.
                Thread.sleep(1100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
            Thread thread = new Thread(() -> minted.set(tryRefresh(oldRefreshToken)));
            attacker.set(thread);
            thread.start();
            // 잠금이 걸려 있으면 이 스레드는 여기서 커밋을 기다리며 멈춰 있다.
            try {
                thread.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        });

        attacker.get().join(10_000);
        return minted.get();
    }

    @Test
    @DisplayName("비밀번호 변경이 커밋되기 전에 옛 토큰으로 재발급해도 살아남는 토큰이 나오지 않는다")
    void changePassword_refreshDuringUncommittedChange_cannotMintSurvivingToken() throws InterruptedException {
        User user = seedUser("race-change@workflow.test");
        String oldRefreshToken = jwtService.issueRefreshToken(user);

        AuthTokenResponse minted = mintDuringUncommittedChange(
            () -> authService.changePassword(user.getId(), OLD_PASSWORD, NEW_PASSWORD), oldRefreshToken);

        if (minted != null) {
            assertThatThrownBy(() -> authService.refresh(minted.refreshToken()))
                .as("변경 도중 재발급된 토큰이 변경 후에도 살아 있다 - 다른 기기 세션 폐기 보장이 깨진다")
                .isInstanceOf(InvalidTokenException.class);
        }
        assertThat(minted)
            .as("변경이 진행 중이면 옛 리프레시 토큰의 재발급은 거부돼야 한다")
            .isNull();
    }

    /**
     * 잠금을 도입한 대가로 생긴 위험을 막는다. 대기에 상한이 없으면 잠금을 기다리는 재발급 요청이
     * 커넥션을 붙든 채 무기한 멈춰 있고, 커넥션 풀이 4개뿐이라 무관한 사용자까지 커넥션을 못 받는다.
     *
     * <p>여기서는 변경 트랜잭션이 잠금을 오래 쥐고 있게 만든 뒤, 재발급이 <em>커밋을 기다리지 않고</em>
     * 상한 시간 안에 끊기는지를 본다. 상한이 없으면 이 스레드는 커밋까지 계속 붙들려 있다.
     */
    @Test
    @DisplayName("잠금이 오래 잡혀 있으면 재발급은 커밋을 기다리지 않고 상한 시간 안에 끊긴다")
    void refresh_whenLockHeldTooLong_failsFastInsteadOfWaitingForCommit() throws InterruptedException {
        User user = seedUser("race-timeout@workflow.test");
        String oldRefreshToken = jwtService.issueRefreshToken(user);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<Long> waitedMs = new AtomicReference<>();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            authService.changePassword(user.getId(), OLD_PASSWORD, NEW_PASSWORD);
            Thread waiter = new Thread(() -> {
                long start = System.nanoTime();
                try {
                    authService.refresh(oldRefreshToken);
                } catch (Throwable t) {
                    failure.set(t);
                } finally {
                    waitedMs.set((System.nanoTime() - start) / 1_000_000);
                }
            });
            waiter.start();
            try {
                // 상한(테스트 설정 1초)보다 넉넉히 오래 잠금을 쥐고 있는다.
                waiter.join(6000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        });

        assertThat(waitedMs.get())
            .as("커밋을 기다렸다면 이 값이 잠금 보유 시간만큼 커진다 - 상한 안에서 끊겨야 한다")
            .isNotNull()
            .isLessThan(5000L);
        assertThat(failure.get())
            .as("무기한 대기 대신 잠금 획득 실패로 끊겨야 한다")
            .isNotNull();
    }

    @Test
    @DisplayName("비밀번호 재설정이 커밋되기 전에 옛 토큰으로 재발급해도 살아남는 토큰이 나오지 않는다")
    void confirmReset_refreshDuringUncommittedReset_cannotMintSurvivingToken() throws InterruptedException {
        User user = seedUser("race-reset@workflow.test");
        String oldRefreshToken = jwtService.issueRefreshToken(user);
        String rawToken = "race-reset-raw-token";
        tokenRepository.save(new PasswordResetToken(
            user.getId(), PasswordResetService.sha256Hex(rawToken), LocalDateTime.now().plusMinutes(30), null));

        AuthTokenResponse minted = mintDuringUncommittedChange(
            () -> passwordResetService.confirmReset(rawToken, NEW_PASSWORD), oldRefreshToken);

        if (minted != null) {
            assertThatThrownBy(() -> authService.refresh(minted.refreshToken()))
                .as("재설정 도중 재발급된 토큰이 재설정 후에도 살아 있다 - 계정 탈취 대응 흐름이 뚫린다")
                .isInstanceOf(InvalidTokenException.class);
        }
        assertThat(minted)
            .as("재설정이 진행 중이면 옛 리프레시 토큰의 재발급은 거부돼야 한다")
            .isNull();
    }
}
