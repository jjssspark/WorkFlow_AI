package com.workflowai.auth;

import com.workflowai.security.JwtService;
import com.workflowai.task.SupabaseStorageClient;
import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.jsonwebtoken.Claims;
import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final String PROVIDER_GOOGLE = "google";
    private static final String PROVIDER_DEMO = "demo";
    private static final String PROVIDER_LOCAL = "local";
    private static final String ROLE_TYPE_MEMBER = "MEMBER";
    private static final String ROLE_TYPE_REVIEWER = "REVIEWER";
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final int AVATAR_SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60;
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
        "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$",
        Pattern.CASE_INSENSITIVE
    );
    private static final Set<String> ALLOWED_ROLE_TYPES = Set.of(ROLE_TYPE_MEMBER, ROLE_TYPE_REVIEWER);

    private final GoogleOAuthService googleOAuthService;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final SupabaseStorageClient storageClient;

    @Autowired
    public AuthService(
        GoogleOAuthService googleOAuthService,
        UserRepository userRepository,
        JwtService jwtService,
        PasswordEncoder passwordEncoder,
        SupabaseStorageClient storageClient
    ) {
        this.googleOAuthService = googleOAuthService;
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
        this.storageClient = storageClient;
    }

    /**
     * storageClient가 추가되기 전 시그니처와의 하위 호환용 생성자. Spring은 위의 @Autowired 생성자로만
     * 빈을 만들고, 이 생성자는 이 시그니처로 직접 AuthService를 생성하던 기존 코드/테스트가 계속
     * 동작하도록 남겨둔다. storageClient가 없으면 avatarUrlOrNull()이 null을 반환하도록 방어한다.
     */
    public AuthService(
        GoogleOAuthService googleOAuthService,
        UserRepository userRepository,
        JwtService jwtService,
        PasswordEncoder passwordEncoder
    ) {
        this(googleOAuthService, userRepository, jwtService, passwordEncoder, null);
    }

    @Transactional
    public AuthTokenResponse loginWithGoogleCode(String code) {
        GoogleTokenResponse tokenResponse = googleOAuthService.exchangeCode(code);
        GoogleUserInfo userInfo = googleOAuthService.fetchUserInfo(tokenResponse.accessToken());

        User user = userRepository.findByProviderAndProviderId(PROVIDER_GOOGLE, userInfo.sub())
            .orElseGet(() -> userRepository.save(
                new User(userInfo.email(), userInfo.name(), PROVIDER_GOOGLE, userInfo.sub())
            ));

        return issueTokens(user);
    }

    /** [개발용] Google OAuth 없이 데모 계정(provider="demo", providerId=demoUserId)으로 즉시 로그인한다. */
    public AuthTokenResponse devLogin(String demoUserId) {
        User user = userRepository.findByProviderAndProviderId(PROVIDER_DEMO, demoUserId)
            .orElseThrow(() -> new IllegalArgumentException("알 수 없는 테스트 계정입니다: " + demoUserId));
        return issueTokens(user);
    }

    /**
     * 이메일/비밀번호 회원가입. REVIEWER는 토큰을 발급하지 않고 승인 대기 상태로만 계정을 만든다.
     * 이용약관/개인정보처리방침 동의는 클라이언트 UI(스크롤 끝까지 확인 등)만으로는 우회될 수 있으므로,
     * 여기서 다시 한번 서버 단에서 각각 필수값으로 검증하고 동의 시각을 DB에 별도 컬럼으로 남긴다.
     * 필드 자체가 없는 요청(구버전 클라이언트 포함)도 예외 없이 거부한다 — 서버 입장에서는 "구버전이라
     * 안 보낸 것"과 "우회 시도로 안 보낸 것"을 구분할 방법이 없기 때문이다.
     */
    @Transactional
    public SignupResponse signup(
        String email, String password, String name, String roleType, boolean termsAgreed, boolean privacyAgreed
    ) {
        String normalizedEmail = normalizeEmail(email);
        String normalizedName = normalizeName(name);
        String normalizedRoleType = normalizeRoleType(roleType);
        if (normalizedName.isBlank()) {
            throw new InvalidSignupInputException("이름과 이메일을 입력해주세요.");
        }
        if (!EMAIL_PATTERN.matcher(normalizedEmail).matches()) {
            throw new InvalidSignupInputException("올바른 이메일 형식으로 입력해주세요.");
        }
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new InvalidSignupInputException("비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 합니다.");
        }
        if (!termsAgreed) {
            throw new InvalidSignupInputException("이용약관에 동의해야 가입할 수 있습니다.");
        }
        if (!privacyAgreed) {
            throw new InvalidSignupInputException("개인정보처리방침에 동의해야 가입할 수 있습니다.");
        }
        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new EmailAlreadyExistsException();
        }

        String passwordHash = passwordEncoder.encode(password);
        boolean isReviewerApplication = ROLE_TYPE_REVIEWER.equals(normalizedRoleType);
        User newUser = new User(normalizedEmail, normalizedName, PROVIDER_LOCAL, normalizedEmail, passwordHash);
        LocalDateTime now = LocalDateTime.now();
        newUser.setTermsAgreedAt(now);
        newUser.setPrivacyAgreedAt(now);
        if (isReviewerApplication) {
            newUser.setReviewerStatus(ReviewerStatus.PENDING);
        }
        User user;
        try {
            user = userRepository.saveAndFlush(newUser);
        } catch (DataIntegrityViolationException e) {
            // PostgreSQL은 제약조건 위반 시 트랜잭션을 abort 상태로 만들어, 같은 트랜잭션 안에서
            // 재조회 쿼리를 날리면 "current transaction is aborted"로 500이 난다. users 테이블의
            // 유니크 제약(uq_users_email, uq_users_provider)은 로컬 가입 시 전부 email 기준이라
            // 재조회 없이 바로 중복 이메일로 판단한다.
            throw new EmailAlreadyExistsException();
        }

        if (isReviewerApplication) {
            return SignupResponse.pendingReviewerApproval();
        }
        return SignupResponse.active(issueTokens(user));
    }

    /**
     * 이메일/비밀번호 로그인. Google 전용 계정(password_hash 없음)은 별도 안내 메시지로 거부하고,
     * 아직 승인되지 않은 REVIEWER 신청 계정(reviewer_status=PENDING)은 로그인 자체를 막는다.
     */
    public AuthTokenResponse loginWithPassword(String email, String password) {
        String normalizedEmail = normalizeEmail(email);
        User user = userRepository.findByEmail(normalizedEmail)
            .orElseThrow(InvalidCredentialsException::new);
        if (user.getPasswordHash() == null) {
            throw new GoogleAccountRequiredException();
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new InvalidCredentialsException();
        }
        if (user.getReviewerStatus() == ReviewerStatus.PENDING) {
            throw new ReviewerApprovalPendingException();
        }
        return issueTokens(user);
    }

    public AuthTokenResponse refresh(String refreshToken) {
        Claims claims = jwtService.parseRefreshToken(refreshToken);
        Long userId = Long.valueOf(claims.getSubject());
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다."));
        return issueTokens(user);
    }

    private AuthTokenResponse issueTokens(User user) {
        String accessToken = jwtService.issueAccessToken(user);
        String refreshToken = jwtService.issueRefreshToken(user);
        UserSummary summary = new UserSummary(
            user.getId(), user.getEmail(), user.getName(),
            user.getAffiliation(), user.getFieldTags(), user.getGithubUsername(), avatarUrlOrNull(user),
            user.isAdmin()
        );
        return new AuthTokenResponse(accessToken, refreshToken, jwtService.accessTokenTtlSeconds(), summary);
    }

    /**
     * 로그인/가입 직후 응답에도 실제 아바타 URL을 채워, 뒤이은 /me 재조회 전까지 프로필 사진이
     * 잠깐이라도 비어 보이는 것을 막는다. 서명 URL 발급이 실패해도 로그인 자체를 막지 않고 null로 넘긴다.
     */
    private String avatarUrlOrNull(User user) {
        if (user.getProfileImagePath() == null || storageClient == null) {
            return null;
        }
        try {
            return storageClient.createSignedUrl(user.getProfileImagePath(), AVATAR_SIGNED_URL_EXPIRES_SECONDS, null);
        } catch (RuntimeException e) {
            log.error("로그인 응답용 프로필 사진 서명 URL 발급 실패: userId={}, path={}", user.getId(), user.getProfileImagePath(), e);
            return null;
        }
    }

    private String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeName(String name) {
        return name == null ? "" : name.trim();
    }

    private String normalizeRoleType(String roleType) {
        String normalized = roleType == null || roleType.isBlank()
            ? ROLE_TYPE_MEMBER
            : roleType.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_ROLE_TYPES.contains(normalized)) {
            throw new InvalidSignupInputException("가입 유형은 MEMBER 또는 REVIEWER만 선택할 수 있습니다.");
        }
        return normalized;
    }
}
