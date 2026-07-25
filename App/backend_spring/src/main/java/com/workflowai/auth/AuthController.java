package com.workflowai.auth;

import com.workflowai.common.ApiResponse;
import com.workflowai.presence.PresenceService;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "인증", description = "Google OAuth 로그인/회원가입, JWT 발급 및 재발급")
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final String STATE_COOKIE = "oauth_state";

    private final GoogleOAuthService googleOAuthService;
    private final AuthService authService;
    private final TestLoginService testLoginService;
    private final PresenceService presenceService;
    private final String frontendBaseUrl;
    private final boolean forceSecureCookies;
    private final boolean devLoginEnabled;

    public AuthController(
        GoogleOAuthService googleOAuthService,
        AuthService authService,
        TestLoginService testLoginService,
        PresenceService presenceService,
        @Value("${workflow.frontend.base-url}") String frontendBaseUrl,
        @Value("${workflow.security.force-secure-cookies:false}") boolean forceSecureCookies,
        @Value("${workflow.demo.dev-login-enabled:false}") boolean devLoginEnabled
    ) {
        this.googleOAuthService = googleOAuthService;
        this.authService = authService;
        this.testLoginService = testLoginService;
        this.presenceService = presenceService;
        this.frontendBaseUrl = frontendBaseUrl;
        this.forceSecureCookies = forceSecureCookies;
        this.devLoginEnabled = devLoginEnabled;

        // 배포 시 Secure 쿠키 설정을 잘못 맞추면 로그인이 조용히 깨지므로, 기동 로그에서 바로 눈에 띄게 남긴다.
        if (frontendBaseUrl.startsWith("https://") && !forceSecureCookies) {
            log.warn(
                "OAuth state cookie security: frontend가 HTTPS({})인데 "
                    + "workflow.security.force-secure-cookies=false다. 프록시가 사설 대역 IP가 아니면 "
                    + "request.isSecure()가 false로 판정되어 Secure 쿠키가 붙지 않고 로그인이 깨질 수 있다 — "
                    + "SERVER_TOMCAT_REMOTEIP_INTERNAL_PROXIES 또는 WORKFLOW_FORCE_SECURE_COOKIES 설정을 확인할 것.",
                frontendBaseUrl
            );
        } else {
            log.info("OAuth state cookie security: force-secure-cookies={}", forceSecureCookies);
        }
    }

    @Operation(summary = "Google OAuth 인가 URL로 리다이렉트")
    @GetMapping("/google")
    public ResponseEntity<Void> redirectToGoogle(HttpServletRequest request) {
        String state = UUID.randomUUID().toString();
        String authorizationUrl = googleOAuthService.buildAuthorizationUrl(state);
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(authorizationUrl))
            .header(HttpHeaders.SET_COOKIE, stateCookie(state, Duration.ofMinutes(5), request).toString())
            .build();
    }

    @Operation(
        summary = "Google OAuth 콜백 처리",
        description = "code를 받아 로그인/회원가입을 처리하고, JWT를 URL 프래그먼트에 실어 프론트엔드로 리다이렉트한다. "
            + "브라우저 최상위 리다이렉트이므로 JSON을 직접 반환할 수 없다. "
            + "state는 /google에서 발급한 HttpOnly 쿠키 값과 대조해 OAuth 콜백 CSRF를 방지한다."
    )
    @GetMapping("/google/callback")
    public ResponseEntity<Void> handleGoogleCallback(
        @RequestParam(required = false) String code,
        @RequestParam(required = false) String state,
        @CookieValue(name = STATE_COOKIE, required = false) String expectedState,
        HttpServletRequest request
    ) {
        ResponseCookie clearStateCookie = stateCookie("", Duration.ZERO, request);

        if (code == null || code.isBlank()) {
            return redirectToFrontend("/login?error=oauth_failed", clearStateCookie);
        }
        if (!statesMatch(state, expectedState)) {
            log.warn("Google OAuth state 불일치로 콜백 거부");
            return redirectToFrontend("/login?error=oauth_failed", clearStateCookie);
        }
        try {
            AuthTokenResponse tokens = authService.loginWithGoogleCode(code);
            String fragment = "accessToken=" + encode(tokens.accessToken())
                + "&refreshToken=" + encode(tokens.refreshToken())
                + "&expiresIn=" + tokens.expiresIn();
            return redirectToFrontend("/auth/callback#" + fragment, clearStateCookie);
        } catch (Exception e) {
            log.warn("Google OAuth 콜백 처리 실패", e);
            return redirectToFrontend("/login?error=oauth_failed", clearStateCookie);
        }
    }

    @Operation(
        summary = "[개발용] 데모 계정으로 즉시 로그인",
        description = "Google OAuth 없이 시딩된 데모 계정(demoUserId: 1~4)으로 바로 로그인한다. "
            + "workflow.demo.dev-login-enabled=false(프로덕션 기본값)이면 404를 반환한다."
    )
    @GetMapping("/dev-login/{demoUserId}")
    public ResponseEntity<Void> devLogin(@PathVariable String demoUserId) {
        if (!devLoginEnabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        try {
            AuthTokenResponse tokens = authService.devLogin(demoUserId);
            String fragment = "accessToken=" + encode(tokens.accessToken())
                + "&refreshToken=" + encode(tokens.refreshToken())
                + "&expiresIn=" + tokens.expiresIn();
            return redirectToFrontend("/auth/callback#" + fragment, stateCookie("", Duration.ZERO));
        } catch (Exception e) {
            log.warn("데모 로그인 실패: {}", demoUserId, e);
            return redirectToFrontend("/login?error=oauth_failed", stateCookie("", Duration.ZERO));
        }
    }

    @Operation(
        summary = "[개발용] 데모 계정 JWT 발급",
        description = "프론트 개발 화면에서 리다이렉트 없이 데모 계정 JWT를 받아 저장할 때 사용한다. "
            + "workflow.demo.dev-login-enabled=false(프로덕션 기본값)이면 404를 반환한다."
    )
    @GetMapping("/dev-login-token/{demoUserId}")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> devLoginToken(@PathVariable String demoUserId) {
        if (!devLoginEnabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail("DEV_LOGIN_DISABLED", "개발용 로그인이 비활성화되어 있습니다."));
        }
        try {
            return ResponseEntity.ok(ApiResponse.ok(authService.devLogin(demoUserId)));
        } catch (Exception e) {
            log.warn("데모 토큰 로그인 실패: {}", demoUserId, e);
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail("DEMO_USER_NOT_FOUND", "테스트 계정을 찾을 수 없습니다."));
        }
    }

    @Operation(
        summary = "[중간보고/시연용] 아이디+비밀번호 테스트 로그인",
        description = "leader/member1~4/reviewer 6개 테스트 계정을 비밀번호 1111로 로그인한다. "
            + "내부적으로 기존 데모 계정(dev-login) 시딩을 재사용하며, 같은 계정이 이미 접속 중(heartbeat TTL 이내)이면 409를 반환한다."
    )
    @PostMapping("/test-login")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> testLogin(@Valid @RequestBody TestLoginRequest request) {
        if (!devLoginEnabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail("DEV_LOGIN_DISABLED", "개발용 로그인이 비활성화되어 있습니다."));
        }
        try {
            return ResponseEntity.ok(ApiResponse.ok(testLoginService.login(request.username(), request.password())));
        } catch (TestAccountAlreadyActiveException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail("TEST_ACCOUNT_ALREADY_ACTIVE", e.getMessage()));
        } catch (InvalidTestCredentialsException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ApiResponse.fail("INVALID_TEST_CREDENTIALS", e.getMessage()));
        }
    }

    @Operation(
        summary = "[중간보고/시연용] 테스트 로그인 접속 상태 해제",
        description = "테스트 계정 로그아웃 시 호출해 접속 상태를 즉시 제거한다. Authorization 헤더가 없거나 유효하지 않아도 200을 반환한다(idempotent)."
    )
    @PostMapping("/test-logout")
    public ApiResponse<Void> testLogout(
        @RequestHeader(name = "X-Workflow-Test-Session-Id", required = false) String testSessionId
    ) {
        releaseCurrentTestSession(testSessionId);
        return ApiResponse.ok(null);
    }

    @Operation(
        summary = "[중간보고/시연용] 접속 상태 heartbeat",
        description = "프론트가 로그인 중 주기적으로 호출해 접속 상태를 갱신한다(TTL 40초). 호출이 끊기면 자동으로 접속 종료 처리된다."
    )
    @PostMapping("/test-session/heartbeat")
    public ApiResponse<Void> heartbeat(
        @RequestHeader(name = "X-Workflow-Test-Session-Id", required = false) String testSessionId
    ) {
        try {
            presenceService.touch(CurrentUser.id(), testSessionId);
        } catch (RuntimeException e) {
            log.debug("heartbeat 무시: 인증 정보 없음");
        }
        return ApiResponse.ok(null);
    }

    private void releaseCurrentTestSession(String testSessionId) {
        try {
            presenceService.release(CurrentUser.id(), testSessionId);
        } catch (RuntimeException e) {
            log.debug("test-logout 무시: 인증 정보 없음");
        }
    }

    @Operation(
        summary = "실제 회원가입 (이메일/비밀번호)",
        description = "이메일/비밀번호로 실제 계정을 생성한다. roleType=REVIEWER면 토큰을 발급하지 않고 "
            + "PENDING_REVIEWER_APPROVAL 상태로만 계정을 만든다(관리자 승인 절차는 아직 없음 — 최소 구현). "
            + "이메일 중복이면 409, 입력값이 유효하지 않으면 400을 반환한다."
    )
    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<SignupResponse>> signup(@Valid @RequestBody SignupRequest request) {
        try {
            boolean termsAgreed = Boolean.TRUE.equals(request.termsAgreed());
            boolean privacyAgreed = Boolean.TRUE.equals(request.privacyAgreed());
            return ResponseEntity.ok(ApiResponse.ok(
                authService.signup(request.email(), request.password(), request.name(), request.roleType(), termsAgreed, privacyAgreed)
            ));
        } catch (EmailAlreadyExistsException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail("EMAIL_ALREADY_EXISTS", e.getMessage()));
        } catch (InvalidSignupInputException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.fail("INVALID_SIGNUP_INPUT", e.getMessage()));
        }
    }

    @Operation(
        summary = "실제 로그인 (이메일/비밀번호)",
        description = "이메일/비밀번호로 로그인한다. Google OAuth로 가입한 계정(비밀번호 없음)이면 401과 함께 "
            + "Google 로그인 안내 메시지를 반환한다."
    )
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthTokenResponse>> login(@Valid @RequestBody LoginRequest request) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(authService.loginWithPassword(request.email(), request.password())));
        } catch (GoogleAccountRequiredException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ApiResponse.fail("GOOGLE_ACCOUNT_REQUIRED", e.getMessage()));
        } catch (ReviewerApprovalPendingException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.fail("REVIEWER_APPROVAL_PENDING", e.getMessage()));
        } catch (InvalidCredentialsException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ApiResponse.fail("INVALID_CREDENTIALS", e.getMessage()));
        }
    }

    @Operation(summary = "Refresh Token으로 Access Token 재발급")
    @PostMapping("/refresh")
    public ApiResponse<AuthTokenResponse> refresh(@Valid @RequestBody RefreshRequest request) {
        return ApiResponse.ok(authService.refresh(request.refreshToken()));
    }

    @Operation(
        summary = "로그아웃",
        description = "Refresh Token은 stateless JWT로 발급되어 서버에 저장하지 않으므로, 실제 폐기는 "
            + "클라이언트가 로컬에 저장된 토큰을 삭제하는 것으로 처리한다 (P0 범위의 알려진 한계)."
    )
    @PostMapping("/logout")
    public ApiResponse<Void> logout() {
        return ApiResponse.ok(null);
    }

    private ResponseEntity<Void> redirectToFrontend(String path, ResponseCookie cookie) {
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(frontendBaseUrl + path))
            .header(HttpHeaders.SET_COOKIE, cookie.toString())
            .build();
    }

    private ResponseCookie stateCookie(String value, Duration maxAge, HttpServletRequest request) {
        return ResponseCookie.from(STATE_COOKIE, value)
            .httpOnly(true)
            .secure(forceSecureCookies || request.isSecure())
            .sameSite("Lax")
            .path("/api/v1/auth")
            .maxAge(maxAge)
            .build();
    }

    /** 개발용 로그인 경로에서 state 쿠키를 지울 때 사용 — 요청의 isSecure() 판단이 필요 없다. */
    private ResponseCookie stateCookie(String value, Duration maxAge) {
        return ResponseCookie.from(STATE_COOKIE, value)
            .httpOnly(true)
            .secure(forceSecureCookies)
            .sameSite("Lax")
            .path("/api/v1/auth")
            .maxAge(maxAge)
            .build();
    }

    /** 타이밍 공격 여지를 없애기 위해 상수 시간으로 state 값을 비교한다. */
    private boolean statesMatch(String state, String expectedState) {
        if (state == null || expectedState == null) {
            return false;
        }
        return MessageDigest.isEqual(
            state.getBytes(StandardCharsets.UTF_8),
            expectedState.getBytes(StandardCharsets.UTF_8)
        );
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
