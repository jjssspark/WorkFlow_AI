package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.support.PostgresRedisIntegrationTest;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * IT-006 구글 OAuth 로그인 연계.
 *
 * <p>구글 서버로 나가는 두 번의 호출({@code exchangeCode}, {@code fetchUserInfo})만 대역으로 바꾼다.
 * 엔드포인트가 {@link GoogleOAuthService}에 상수로 박혀 있어 로컬 스텁으로 돌릴 수 없고, 애초에
 * 검증 대상도 구글이 아니라 <strong>콜백을 받은 뒤 우리 쪽에서 일어나는 일</strong>이다.
 *
 * <p>이 경로가 다른 로그인과 다른 점이 두 가지다.
 *
 * <ul>
 *   <li><strong>성공과 실패가 둘 다 302다.</strong> JSON을 못 주는 브라우저 최상위 리다이렉트라
 *       상태 코드로는 구분되지 않고 Location만이 가른다. 그래서 "302가 나왔다"는 단정은
 *       아무것도 검증하지 못한다.
 *   <li><strong>계정 식별이 이메일이 아니라 {@code (provider, sub)}다.</strong> 구글이 주는 sub는
 *       불변이고 이메일은 바뀔 수 있다. 재로그인 시 계정이 새로 생기는지 여부가 여기에 달려 있다.
 * </ul>
 *
 * <p>state 쿠키는 직접 만들어 넣지 않고 {@code /google}이 실제로 발급한 것을 그대로 쓴다.
 * 값을 지어내면 "우리가 발급한 쿠키를 우리 콜백이 받아들이는가"는 검증되지 않는다.
 */
class GoogleOAuthLoginIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String GOOGLE_SUB = "google-sub-it006";
    private static final String GOOGLE_EMAIL = "oauth@workflow.test";
    private static final String GOOGLE_NAME = "구글 로그인 검증";
    private static final String STATE_COOKIE = "oauth_state";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private GoogleOAuthService googleOAuthService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void stubGoogleAndClearAccount() {
        jdbcTemplate.update("DELETE FROM users WHERE provider = 'google' AND provider_id = ?", GOOGLE_SUB);

        when(googleOAuthService.buildAuthorizationUrl(anyString()))
            .thenAnswer(call -> "https://accounts.google.com/o/oauth2/v2/auth?state=" + call.getArgument(0));
        when(googleOAuthService.exchangeCode(anyString()))
            .thenReturn(new GoogleTokenResponse("google-access-token", 3600L, "Bearer", null));
        when(googleOAuthService.fetchUserInfo("google-access-token"))
            .thenReturn(new GoogleUserInfo(GOOGLE_SUB, GOOGLE_NAME, GOOGLE_EMAIL, true, null));
    }

    @Test
    void callbackCreatesTheAccountAndIssuesTokensThatWorkOnProtectedApis() throws Exception {
        MvcResult callback = completeLogin();

        String accessToken = accessTokenFromRedirect(callback);

        // 프래그먼트에 토큰 '문자열이 들어 있다'와 '그 토큰이 이 앱에서 통한다'는 다른 얘기다.
        // 프론트는 이 값을 그대로 Authorization 헤더에 넣으므로 여기까지 확인해야 연계가 증명된다.
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + accessToken))
            .andExpect(status().isOk());

        assertThat(emailOf(GOOGLE_SUB)).isEqualTo(GOOGLE_EMAIL);
    }

    @Test
    void secondLoginReusesTheSameAccountInsteadOfCreatingAnother() throws Exception {
        completeLogin();
        long firstUserId = userIdOf(GOOGLE_SUB);

        completeLogin();

        assertThat(userIdOf(GOOGLE_SUB)).isEqualTo(firstUserId);
        assertThat(countOf(GOOGLE_SUB)).isEqualTo(1);
    }

    @Test
    void stateMismatchIsRejectedAndNoAccountIsCreated() throws Exception {
        // 위 두 테스트의 대조군이다. 성공도 302, 실패도 302라서 이걸 함께 걸지 않으면
        // state 검사를 통째로 지워도 앞 테스트들은 그대로 통과한다.
        // 계정 생성 여부까지 보는 이유: 리다이렉트만 막고 loginWithGoogleCode는 이미 실행된
        // 순서였다면 화면은 실패로 보이는데 계정은 만들어져 있다.
        mockMvc.perform(get("/api/v1/auth/google/callback")
                .param("code", "auth-code")
                .param("state", "attacker-supplied-state")
                .cookie(new Cookie(STATE_COOKIE, "state-issued-to-someone-else")))
            .andExpect(status().isFound())
            .andExpect(result -> assertThat(location(result)).contains("/login?error=oauth_failed"));

        assertThat(countOf(GOOGLE_SUB)).isZero();
    }

    /** {@code /google}으로 state 쿠키를 발급받고 그 쿠키로 콜백까지 태운다. */
    private MvcResult completeLogin() throws Exception {
        Cookie stateCookie = mockMvc.perform(get("/api/v1/auth/google"))
            .andExpect(status().isFound())
            .andReturn()
            .getResponse()
            .getCookie(STATE_COOKIE);
        assertThat(stateCookie).as("/google이 state 쿠키를 발급해야 콜백을 검증할 수 있다").isNotNull();

        MvcResult result = mockMvc.perform(get("/api/v1/auth/google/callback")
                .param("code", "auth-code")
                .param("state", stateCookie.getValue())
                .cookie(stateCookie))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(location(result)).contains("/auth/callback#accessToken=");
        return result;
    }

    private String accessTokenFromRedirect(MvcResult result) {
        String fragment = location(result).split("#", 2)[1];
        for (String pair : fragment.split("&")) {
            if (pair.startsWith("accessToken=")) {
                return URLDecoder.decode(pair.substring("accessToken=".length()), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("리다이렉트 프래그먼트에 accessToken이 없습니다: " + fragment);
    }

    private String location(MvcResult result) {
        String location = result.getResponse().getHeader("Location");
        assertThat(location).as("리다이렉트 응답에 Location이 있어야 한다").isNotNull();
        return location;
    }

    private long userIdOf(String sub) {
        Long id = jdbcTemplate.queryForObject(
            "SELECT id FROM users WHERE provider = 'google' AND provider_id = ?", Long.class, sub);
        assertThat(id).as("구글 계정이 생성돼 있어야 한다").isNotNull();
        return id;
    }

    private String emailOf(String sub) {
        return jdbcTemplate.queryForObject(
            "SELECT email FROM users WHERE provider = 'google' AND provider_id = ?", String.class, sub);
    }

    private int countOf(String sub) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM users WHERE provider = 'google' AND provider_id = ?", Integer.class, sub);
        return count == null ? 0 : count;
    }
}
