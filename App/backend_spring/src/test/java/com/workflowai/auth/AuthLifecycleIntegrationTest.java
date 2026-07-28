package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.support.PostgresRedisIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * IT-003 회원가입~로그인~내 정보 연계 / IT-004 토큰 재발급 후 보호 API 접근 연계.
 *
 * <p>여기서 검증하는 것은 "토큰을 만드는 쪽"과 "토큰을 읽는 쪽"이 실제로 맞물리는가다.
 * 두 쪽은 서로를 전혀 모른다.
 *
 * <ul>
 *   <li>발급 - {@link AuthService}가 {@link com.workflowai.security.JwtService}로 서명
 *   <li>검증 - {@code JwtAuthenticationFilter}가 SecurityContext를 채움
 *   <li>사용 - {@link MeController}가 SecurityContext에서 사용자를 꺼냄
 * </ul>
 *
 * <p>기존 테스트는 이 사이를 지나가지 않는다. {@code AuthServiceTest}는 HTTP·필터를 안 거치고,
 * {@code MeControllerTest}는 @WebMvcTest 슬라이스라 필터 체인 자체를 로드하지 않는다.
 * 그래서 "발급된 토큰을 이 앱이 실제로 받아들이는가"는 어느 쪽도 보지 않는다.
 *
 * <p><strong>특히 access/refresh 구분이 얇다.</strong> 둘은 같은 비밀키로 서명되고
 * {@code typ} 클레임 하나로만 갈린다({@code JwtService#requireType}). 서명 검증만으로는 구분되지
 * 않으므로, refresh 토큰을 Authorization 헤더에 넣어도 통과하는 사고가 가능하다. 그 한 줄이
 * 사라졌을 때 실패하는 테스트가 이 클래스 말고는 없다.
 */
class AuthLifecycleIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String EMAIL = "lifecycle@workflow.test";
    private static final String PASSWORD = "Lifecycle!123";
    private static final String NAME = "생애주기 검증";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 컨테이너를 다른 테스트 클래스와 공유하므로 이 계정이 남아 있으면 가입이 409가 된다.
     * 회원가입 자체가 검증 대상이라 여기서 가입까지 해두지는 않는다.
     */
    @BeforeEach
    void removeLeftoverAccount() {
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", EMAIL);
    }

    @Test
    void signupIssuesTokensThatTheSecurityFilterActuallyAccepts() throws Exception {
        JsonNode tokens = signup().get("data").get("tokens");

        // 가입 응답이 토큰을 담고 있다는 것과, 그 토큰이 이 앱에서 통한다는 것은 다른 얘기다.
        // 앞은 AuthServiceTest도 보지만 뒤는 필터 체인을 지나야만 알 수 있다.
        me(tokens.get("accessToken").asText())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.user.email").value(EMAIL))
            .andExpect(jsonPath("$.data.user.name").value(NAME));
    }

    @Test
    void loginAfterSignupReachesTheSameAccount() throws Exception {
        long signedUpUserId = signup().get("data").get("tokens").get("user").get("id").asLong();

        JsonNode loginTokens = login().get("data");

        // id까지 비교하는 이유: 이메일만 보면 "로그인이 성공했다"까지만 확인된다.
        // 같은 이메일로 계정이 두 개 생겼거나 토큰의 subject가 다른 사용자를 가리켜도
        // 이메일 단정만으로는 드러나지 않는다.
        me(loginTokens.get("accessToken").asText())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.user.id").value(signedUpUserId))
            .andExpect(jsonPath("$.data.user.email").value(EMAIL));
    }

    @Test
    void refreshedAccessTokenIsAcceptedByProtectedApis() throws Exception {
        signup();
        JsonNode loginTokens = login().get("data");
        long userId = loginTokens.get("user").get("id").asLong();

        JsonNode refreshed = refresh(loginTokens.get("refreshToken").asText()).get("data");

        me(refreshed.get("accessToken").asText())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.user.id").value(userId));
    }

    @Test
    void refreshTokenCannotStandInForAnAccessToken() throws Exception {
        signup();
        String refreshToken = login().get("data").get("refreshToken").asText();

        // 위 테스트의 대조군이다. 이게 없으면 refresh 엔드포인트가 access 대신 refresh 토큰을
        // 돌려주도록 바뀌어도 앞 테스트는 통과한다 - 두 토큰은 같은 키로 서명돼 있어서
        // 서명 검증만으로는 구분되지 않기 때문이다.
        me(refreshToken)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.success").value(false));
    }

    private JsonNode signup() throws Exception {
        String body = """
            {"email":"%s","password":"%s","name":"%s","roleType":"MEMBER",
             "termsAgreed":true,"privacyAgreed":true}
            """.formatted(EMAIL, PASSWORD, NAME);
        return json(mockMvc.perform(post("/api/v1/auth/signup")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("ACTIVE")));
    }

    private JsonNode login() throws Exception {
        String body = """
            {"email":"%s","password":"%s"}
            """.formatted(EMAIL, PASSWORD);
        return json(mockMvc.perform(post("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andExpect(status().isOk()));
    }

    private JsonNode refresh(String refreshToken) throws Exception {
        String body = """
            {"refreshToken":"%s"}
            """.formatted(refreshToken);
        return json(mockMvc.perform(post("/api/v1/auth/refresh")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andExpect(status().isOk()));
    }

    private ResultActions me(String accessToken) throws Exception {
        return mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + accessToken));
    }

    private JsonNode json(ResultActions result) throws Exception {
        JsonNode root = objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
        assertThat(root.get("success").asBoolean()).isTrue();
        return root;
    }
}
