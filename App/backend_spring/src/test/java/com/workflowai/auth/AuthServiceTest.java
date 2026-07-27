package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.security.JwtService;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock private GoogleOAuthService googleOAuthService;
    @Mock private UserRepository userRepository;
    @Mock private JwtService jwtService;
    @Mock private S3StorageClient storageClient;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(googleOAuthService, userRepository, jwtService, passwordEncoder, storageClient);
    }

    @Test
    void signup_savesBcryptHashedPassword_andIssuesTokensForMember() {
        when(userRepository.existsByEmail("new@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(jwtService.issueAccessToken(any())).thenReturn("access-token");
        when(jwtService.issueRefreshToken(any())).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);

        SignupResponse response = authService.signup(" New@Example.COM ", "12345678", " 홍길동 ", "MEMBER", true, true, null, null);

        ArgumentCaptor<User> savedUser = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(savedUser.capture());
        assertThat(savedUser.getValue().getPasswordHash()).isNotEqualTo("12345678");
        assertThat(passwordEncoder.matches("12345678", savedUser.getValue().getPasswordHash())).isTrue();
        assertThat(savedUser.getValue().getProvider()).isEqualTo("local");
        assertThat(savedUser.getValue().getEmail()).isEqualTo("new@example.com");
        assertThat(savedUser.getValue().getName()).isEqualTo("홍길동");
        assertThat(savedUser.getValue().getTermsAgreedAt()).isNotNull();
        assertThat(savedUser.getValue().getPrivacyAgreedAt()).isNotNull();

        assertThat(response.status()).isEqualTo("ACTIVE");
        assertThat(response.tokens()).isNotNull();
        assertThat(response.tokens().accessToken()).isEqualTo("access-token");
    }

    @Test
    void signup_reviewer_doesNotIssueTokens_andMarksPending() {
        when(userRepository.existsByEmail("prof@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SignupResponse response = authService.signup(
            "prof@example.com", "12345678", "고교수", "REVIEWER", true, true, "컴퓨터공학과", "PROF-001"
        );

        assertThat(response.status()).isEqualTo("PENDING_REVIEWER_APPROVAL");
        assertThat(response.tokens()).isNull();

        ArgumentCaptor<User> savedUser = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(savedUser.capture());
        assertThat(savedUser.getValue().getReviewerStatus()).isEqualTo(ReviewerStatus.PENDING);
    }

    @Test
    void signup_reviewer_missingAffiliation_throws() {
        assertThatThrownBy(() -> authService.signup(
            "noaff@example.com", "12345678", "고교수", "REVIEWER", true, true, null, "PROF-001"
        )).isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_reviewer_missingFacultyId_throws() {
        assertThatThrownBy(() -> authService.signup(
            "nofac@example.com", "12345678", "고교수", "REVIEWER", true, true, "컴퓨터공학과", null
        )).isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_reviewer_facultyIdInvalidCharacters_throws() {
        assertThatThrownBy(() -> authService.signup(
            "badchar@example.com", "12345678", "고교수", "REVIEWER", true, true, "컴퓨터공학과", "교수#001"
        )).isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_reviewer_savesAffiliationAndFacultyId() {
        when(userRepository.existsByEmail("prof2@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        authService.signup("prof2@example.com", "12345678", "고교수", "REVIEWER", true, true, "컴퓨터공학과", "PROF-2026-001");

        ArgumentCaptor<User> savedUser = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(savedUser.capture());
        assertThat(savedUser.getValue().getAffiliation()).isEqualTo("컴퓨터공학과");
        assertThat(savedUser.getValue().getFacultyId()).isEqualTo("PROF-2026-001");
        assertThat(savedUser.getValue().getReviewerStatus()).isEqualTo(ReviewerStatus.PENDING);
    }

    @Test
    void loginWithPassword_rejectedReviewer_throwsWithReason() {
        String hash = passwordEncoder.encode("12345678");
        User rejected = new User("rejected@example.com", "고교수", "local", "rejected@example.com", hash);
        rejected.setReviewerStatus(ReviewerStatus.REJECTED);
        rejected.setReviewerRejectionReason("교수 식별번호를 다시 확인해주세요.");
        when(userRepository.findByEmail("rejected@example.com")).thenReturn(Optional.of(rejected));

        assertThatThrownBy(() -> authService.loginWithPassword("rejected@example.com", "12345678"))
            .isInstanceOf(ReviewerApplicationRejectedException.class)
            .hasMessageContaining("교수 식별번호를 다시 확인해주세요.");
    }

    @Test
    void loginWithPassword_pendingReviewer_isBlocked() {
        String hash = passwordEncoder.encode("12345678");
        User pendingReviewer = new User("prof@example.com", "고교수", "local", "prof@example.com", hash);
        pendingReviewer.setReviewerStatus(ReviewerStatus.PENDING);
        when(userRepository.findByEmail("prof@example.com")).thenReturn(Optional.of(pendingReviewer));

        assertThatThrownBy(() -> authService.loginWithPassword("prof@example.com", "12345678"))
            .isInstanceOf(ReviewerApprovalPendingException.class);
    }

    @Test
    void loginWithPassword_approvedReviewer_issuesTokens() {
        String hash = passwordEncoder.encode("12345678");
        User approvedReviewer = new User("prof@example.com", "고교수", "local", "prof@example.com", hash);
        approvedReviewer.setReviewerStatus(ReviewerStatus.APPROVED);
        when(userRepository.findByEmail("prof@example.com")).thenReturn(Optional.of(approvedReviewer));
        when(jwtService.issueAccessToken(approvedReviewer)).thenReturn("access-token");
        when(jwtService.issueRefreshToken(approvedReviewer)).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);

        AuthTokenResponse tokens = authService.loginWithPassword("prof@example.com", "12345678");

        assertThat(tokens.accessToken()).isEqualTo("access-token");
    }

    @Test
    void signup_duplicateEmail_throws() {
        when(userRepository.existsByEmail("dup@example.com")).thenReturn(true);

        assertThatThrownBy(() -> authService.signup("dup@example.com", "12345678", "이름", "MEMBER", true, true, null, null))
            .isInstanceOf(EmailAlreadyExistsException.class);
    }

    @Test
    void signup_duplicateEmailRace_throwsConflictDomainException() {
        when(userRepository.existsByEmail("race@example.com")).thenReturn(false, true);
        when(userRepository.saveAndFlush(any(User.class))).thenThrow(new DataIntegrityViolationException("duplicate email"));

        assertThatThrownBy(() -> authService.signup("race@example.com", "12345678", "이름", "MEMBER", true, true, null, null))
            .isInstanceOf(EmailAlreadyExistsException.class);
    }

    @Test
    void signup_shortPassword_throws() {
        assertThatThrownBy(() -> authService.signup("short@example.com", "1234", "이름", "MEMBER", true, true, null, null))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_invalidEmail_throws() {
        assertThatThrownBy(() -> authService.signup("not-an-email", "12345678", "이름", "MEMBER", true, true, null, null))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_invalidRoleType_throws() {
        assertThatThrownBy(() -> authService.signup("role@example.com", "12345678", "이름", "ADMIN", true, true, null, null))
            .isInstanceOf(InvalidSignupInputException.class);
    }

    @Test
    void signup_termsNotAgreed_throwsAndNeverSaves() {
        assertThatThrownBy(() -> authService.signup("terms@example.com", "12345678", "이름", "MEMBER", false, true, null, null))
            .isInstanceOf(InvalidSignupInputException.class);

        verify(userRepository, org.mockito.Mockito.never()).saveAndFlush(any());
    }

    @Test
    void signup_privacyNotAgreed_throwsAndNeverSaves() {
        assertThatThrownBy(() -> authService.signup("privacy@example.com", "12345678", "이름", "MEMBER", true, false, null, null))
            .isInstanceOf(InvalidSignupInputException.class);

        verify(userRepository, org.mockito.Mockito.never()).saveAndFlush(any());
    }

    @Test
    void loginWithPassword_avatarSet_returnsSignedUrlInTokenResponse() {
        String hash = passwordEncoder.encode("12345678");
        User user = new User("avatar@example.com", "홍길동", "local", "avatar@example.com", hash);
        user.setProfileImagePath("avatars/1/pic.png");
        when(userRepository.findByEmail("avatar@example.com")).thenReturn(Optional.of(user));
        when(jwtService.issueAccessToken(user)).thenReturn("access-token");
        when(jwtService.issueRefreshToken(user)).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);
        when(storageClient.createSignedUrl("avatars/1/pic.png", 86400, null)).thenReturn("https://signed.example/avatars/1/pic.png");

        AuthTokenResponse tokens = authService.loginWithPassword("avatar@example.com", "12345678");

        assertThat(tokens.user().avatarUrl()).isEqualTo("https://signed.example/avatars/1/pic.png");
    }

    @Test
    void loginWithPassword_normalizesEmail() {
        String hash = passwordEncoder.encode("12345678");
        User user = new User("local@example.com", "홍길동", "local", "local@example.com", hash);
        when(userRepository.findByEmail("local@example.com")).thenReturn(Optional.of(user));
        when(jwtService.issueAccessToken(user)).thenReturn("access-token");
        when(jwtService.issueRefreshToken(user)).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);

        AuthTokenResponse tokens = authService.loginWithPassword(" Local@Example.COM ", "12345678");

        assertThat(tokens.accessToken()).isEqualTo("access-token");
    }

    @Test
    void loginWithPassword_correctPassword_issuesTokens() {
        String hash = passwordEncoder.encode("12345678");
        User user = new User("local@example.com", "홍길동", "local", "local@example.com", hash);
        when(userRepository.findByEmail("local@example.com")).thenReturn(Optional.of(user));
        when(jwtService.issueAccessToken(user)).thenReturn("access-token");
        when(jwtService.issueRefreshToken(user)).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);

        AuthTokenResponse tokens = authService.loginWithPassword("local@example.com", "12345678");

        assertThat(tokens.accessToken()).isEqualTo("access-token");
    }

    @Test
    void loginWithPassword_wrongPassword_throwsInvalidCredentials() {
        String hash = passwordEncoder.encode("12345678");
        User user = new User("local@example.com", "홍길동", "local", "local@example.com", hash);
        when(userRepository.findByEmail("local@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> authService.loginWithPassword("local@example.com", "wrong-password"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void loginWithPassword_unknownEmail_throwsInvalidCredentials() {
        when(userRepository.findByEmail("nobody@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.loginWithPassword("nobody@example.com", "12345678"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void loginWithPassword_googleOnlyAccount_throwsGoogleAccountRequired() {
        User googleUser = new User("google@example.com", "구글유저", "google", "google-sub-123");
        when(userRepository.findByEmail("google@example.com")).thenReturn(Optional.of(googleUser));

        assertThatThrownBy(() -> authService.loginWithPassword("google@example.com", "anything"))
            .isInstanceOf(GoogleAccountRequiredException.class);
    }

    @Test
    void devLogin_stillWorksForTestAccounts() {
        User demoUser = new User("demo-user-1@workflow.ai", "허영주", "demo", "1");
        when(userRepository.findByProviderAndProviderId("demo", "1")).thenReturn(Optional.of(demoUser));
        when(jwtService.issueAccessToken(demoUser)).thenReturn("access-token");
        when(jwtService.issueRefreshToken(demoUser)).thenReturn("refresh-token");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(1800L);

        AuthTokenResponse tokens = authService.devLogin("1");

        assertThat(tokens.accessToken()).isEqualTo("access-token");
    }

    @Test
    void reapplyAsReviewer_rejectedUser_movesToPendingWithNewFields() {
        String hash = passwordEncoder.encode("12345678");
        User rejected = new User("rejected@example.com", "고교수", "local", "rejected@example.com", hash);
        rejected.setReviewerStatus(ReviewerStatus.REJECTED);
        rejected.setReviewerRejectionReason("교수 식별번호를 다시 확인해주세요.");
        when(userRepository.findByEmail("rejected@example.com")).thenReturn(Optional.of(rejected));

        SignupResponse response = authService.reapplyAsReviewer(
            "rejected@example.com", "12345678", "전자공학과", "PROF-2026-002"
        );

        assertThat(response.status()).isEqualTo("PENDING_REVIEWER_APPROVAL");
        assertThat(rejected.getReviewerStatus()).isEqualTo(ReviewerStatus.PENDING);
        assertThat(rejected.getAffiliation()).isEqualTo("전자공학과");
        assertThat(rejected.getFacultyId()).isEqualTo("PROF-2026-002");
        assertThat(rejected.getReviewerRejectionReason()).isNull();
        verify(userRepository).save(rejected);
    }

    @Test
    void reapplyAsReviewer_nonRejectedUser_throws() {
        String hash = passwordEncoder.encode("12345678");
        User pending = new User("pending@example.com", "고교수", "local", "pending@example.com", hash);
        pending.setReviewerStatus(ReviewerStatus.PENDING);
        when(userRepository.findByEmail("pending@example.com")).thenReturn(Optional.of(pending));

        assertThatThrownBy(() -> authService.reapplyAsReviewer("pending@example.com", "12345678", "전자공학과", "PROF-2026-002"))
            .isInstanceOf(ReapplyNotAllowedException.class);
    }

    @Test
    void reapplyAsReviewer_wrongPassword_throwsInvalidCredentials() {
        String hash = passwordEncoder.encode("12345678");
        User rejected = new User("rejected2@example.com", "고교수", "local", "rejected2@example.com", hash);
        rejected.setReviewerStatus(ReviewerStatus.REJECTED);
        when(userRepository.findByEmail("rejected2@example.com")).thenReturn(Optional.of(rejected));

        assertThatThrownBy(() -> authService.reapplyAsReviewer("rejected2@example.com", "wrong-password", "전자공학과", "PROF-2026-002"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void reapplyAsReviewer_missingFacultyId_throws() {
        String hash = passwordEncoder.encode("12345678");
        User rejected = new User("rejected3@example.com", "고교수", "local", "rejected3@example.com", hash);
        rejected.setReviewerStatus(ReviewerStatus.REJECTED);
        when(userRepository.findByEmail("rejected3@example.com")).thenReturn(Optional.of(rejected));

        assertThatThrownBy(() -> authService.reapplyAsReviewer("rejected3@example.com", "12345678", "전자공학과", null))
            .isInstanceOf(InvalidSignupInputException.class);
    }
}
