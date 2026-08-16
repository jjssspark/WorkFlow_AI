package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.security.JwtProperties;
import com.workflowai.security.JwtService;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 로그인 상태에서의 비밀번호 변경.
 *
 * <p>JwtService는 목이 아니라 실물을 쓴다. 이 기능의 핵심 위험이 "발급한 토큰의 iat이
 * passwordChangedAt과 같은 초라서 즉시 거부된다"는 것이고, 그 경계는 실제로 토큰을 만들어
 * 실제 검증 경로에 통과시켜 봐야만 드러나기 때문이다. 목으로는 이 회귀를 잡을 수 없다.
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceChangePasswordTest {

    private static final long USER_ID = 42L;
    private static final String CURRENT_PASSWORD = "current-pw-1234";

    @Mock private GoogleOAuthService googleOAuthService;
    @Mock private UserRepository userRepository;
    @Mock private S3StorageClient storageClient;
    @Mock private PasswordResetTokenRepository passwordResetTokenRepository;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final JwtService jwtService = new JwtService(
        new JwtProperties("test-secret-key-for-change-password-suite-0123456789", 1800L, 1209600L));

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(
            googleOAuthService, userRepository, jwtService, passwordEncoder, storageClient,
            passwordResetTokenRepository);
    }

    private User localUser() {
        User user = new User(
            "member@example.com", "홍길동", "local", "member@example.com",
            passwordEncoder.encode(CURRENT_PASSWORD));
        ReflectionTestUtils.setField(user, "id", USER_ID);
        return user;
    }

    @Test
    void changePassword_googleAccountWithoutPassword_isRejected() {
        User googleUser = new User("g@example.com", "홍길동", "google", "google-sub-1");
        ReflectionTestUtils.setField(googleUser, "id", USER_ID);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(googleUser));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "anything", "new-password-1234"))
            .isInstanceOf(GoogleAccountRequiredException.class);
    }

    @Test
    void changePassword_wrongCurrentPassword_isRejected() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "wrong-password", "new-password-1234"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void changePassword_wrongCurrentPassword_doesNotTouchTheAccount() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "wrong-password", "new-password-1234"))
            .isInstanceOf(InvalidCredentialsException.class);

        verify(userRepository, never()).saveAndFlush(any(User.class));
        verify(passwordResetTokenRepository, never()).invalidateAllUnusedByUserId(any());
    }

    @Test
    void changePassword_googleAccount_saysThereIsNoPasswordRatherThanTellingThemToLogIn() {
        // 로그인 화면 문구("Google 계정으로 로그인해주세요")를 그대로 쓰면, 이미 로그인해서
        // 설정 화면에 들어와 있는 사용자에게 로그인하라고 말하는 꼴이 된다.
        User googleUser = new User("g@example.com", "홍길동", "google", "google-sub-1");
        ReflectionTestUtils.setField(googleUser, "id", USER_ID);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(googleUser));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "anything", "new-password-1234"))
            .hasMessageContaining("비밀번호")
            .hasMessageNotContaining("로그인해주세요");
    }

    @Test
    void changePassword_wrongCurrentPassword_saysCurrentPasswordNotEmail() {
        // 이 화면에는 이메일 입력란이 없다. 로그인용 문구("이메일 또는 비밀번호가...")를 그대로
        // 흘리면 사용자가 어느 칸을 고쳐야 하는지 알 수 없다.
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "wrong-password", "new-password-1234"))
            .hasMessageContaining("현재 비밀번호")
            .hasMessageNotContaining("이메일");
    }

    @Test
    void changePassword_newPasswordShorterThanMinimum_isRejected() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, CURRENT_PASSWORD, "1234567"))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void changePassword_newPasswordLongerThanMaximum_isRejected() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));
        String tooLong = "a".repeat(129);

        assertThatThrownBy(() -> authService.changePassword(USER_ID, CURRENT_PASSWORD, tooLong))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    /**
     * BCryptPasswordEncoder는 72바이트를 넘는 입력을 자르지 않고 IllegalArgumentException을 던진다
     * ("password cannot be more than 72 bytes"). 글자 수만 세면 정책을 통과한 입력이 encode()에서
     * 터져 500이 난다. 한글은 UTF-8 3바이트라 25자만 되어도 걸린다 — 글자 수가 아니라 바이트로 봐야 한다.
     */
    @Test
    void changePassword_newPasswordOver72Bytes_isRejectedAsInputNotServerError() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));
        String korean25 = "가".repeat(25); // 75 bytes

        assertThatThrownBy(() -> authService.changePassword(USER_ID, CURRENT_PASSWORD, korean25))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void changePassword_asciiNewPasswordOver72Bytes_isRejectedAsInputNotServerError() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, CURRENT_PASSWORD, "a".repeat(73)))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    /**
     * 현재 비밀번호는 길이를 따로 막지 않는다. 72바이트 한계는 encode()에만 있고 matches()에는 없어서,
     * 초과 입력은 예외가 아니라 그냥 false로 돌아오기 때문이다(확인함). 그래서 새 비밀번호 쪽과 달리
     * 여기서는 바이트 검사가 필요 없다.
     *
     * <p>일부러 막지 않는 이유도 있다. checkpw는 72바이트에서 잘라서 비교하므로, "초과 = 무조건 오답"으로
     * 처리하면 자르던 시절의 인코더로 만들어진 해시를 쓰는 계정이 자기 비밀번호로 로그인하지 못하게 된다.
     *
     * <p>이 테스트는 그 전제가 깨지는 순간을 잡는 회귀 방지선이다. Spring Security가 encode()처럼
     * matches()에도 검사를 넣으면 여기서 IllegalArgumentException이 나면서 빨개진다 — 그때 막으면 된다.
     */
    @Test
    void changePassword_currentPasswordOver72Bytes_isRejectedAsCredentialsNotServerError() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, "가".repeat(25), "new-password-1234"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void changePassword_newPasswordSameAsCurrent_isRejected() {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(localUser()));

        assertThatThrownBy(() -> authService.changePassword(USER_ID, CURRENT_PASSWORD, CURRENT_PASSWORD))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void changePassword_success_storesNewHashAndStampsPasswordChangedAt() {
        User user = localUser();
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(call -> call.getArgument(0));
        LocalDateTime before = LocalDateTime.now();

        authService.changePassword(USER_ID, CURRENT_PASSWORD, "new-password-1234");

        assertThat(passwordEncoder.matches("new-password-1234", user.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches(CURRENT_PASSWORD, user.getPasswordHash())).isFalse();
        assertThat(user.getPasswordChangedAt()).isNotNull().isAfterOrEqualTo(before);
    }

    @Test
    void changePassword_success_invalidatesPendingResetLinks() {
        User user = localUser();
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(call -> call.getArgument(0));

        authService.changePassword(USER_ID, CURRENT_PASSWORD, "new-password-1234");

        // 비밀번호를 바꿨는데 예전에 메일로 받은 재설정 링크가 살아 있으면 안 된다.
        verify(passwordResetTokenRepository).invalidateAllUnusedByUserId(USER_ID);
    }

    /**
     * 이 기능의 핵심 회귀 테스트.
     *
     * <p>{@code rejectIfIssuedBeforePasswordChange}는 {@code iat <= passwordChangedAt}이면 거부한다.
     * 비밀번호 변경은 bcrypt 때문에 수백 ms가 걸리므로, 변경 직후 평범하게 발급한 리프레시 토큰의
     * iat은 passwordChangedAt과 같은 초가 되기 쉽다. 그러면 방금 발급한 토큰이 즉시 무효가 되어
     * 사용자가 이유 없이 튕긴다. 발급 시각을 경계 밖으로 밀어내야 통과한다.
     */
    @Test
    void changePassword_issuedRefreshToken_survivesTheStaleTokenCheck() {
        User user = localUser();
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        // 변경은 배타 잠금, 재발급은 공유 잠금으로 읽는다(경쟁 조건 차단). 여기선 같은 사용자다.
        when(userRepository.findByIdForShare(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(call -> call.getArgument(0));

        AuthTokenResponse issued = authService.changePassword(USER_ID, CURRENT_PASSWORD, "new-password-1234");

        assertThatCode(() -> authService.refresh(issued.refreshToken())).doesNotThrowAnyException();
    }

    @Test
    void changePassword_refreshTokenIssuedBeforeTheChange_isStillRejected() {
        User user = localUser();
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.findByIdForShare(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(call -> call.getArgument(0));
        String tokenFromOtherDevice = jwtService.issueRefreshToken(user);

        authService.changePassword(USER_ID, CURRENT_PASSWORD, "new-password-1234");

        // 다른 기기의 세션은 끊겨야 한다 - 그것이 비밀번호를 바꾸는 이유 중 하나다.
        assertThatThrownBy(() -> authService.refresh(tokenFromOtherDevice))
            .isInstanceOf(com.workflowai.security.InvalidTokenException.class);
    }
}
