package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.support.PostgresRedisIntegrationTest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * IT-007 테스트 계정 동시 접속 제한 연계.
 *
 * <p>시연용 공용 계정(leader/member1~5/reviewer, 비밀번호 1111)은 여러 사람이 같은 아이디를 쓴다.
 * 두 사람이 동시에 붙으면 한쪽이 만든 데이터를 다른 쪽이 덮어쓰거나 지우는 일이 시연 중에 일어난다.
 * 그걸 막는 유일한 장치가 {@code PresenceService.tryAcquire}의 409 한 줄이다.
 *
 * <p><strong>TTL 만료 경로는 여기서 검증하지 않는다.</strong> TTL이 40초 상수로 박혀 있고
 * ({@code PresenceService#TTL}) 시계를 주입할 수 없어, 실측하려면 테스트가 40초를 자야 한다.
 * 만료 경계는 단위 케이스(UT-132)의 몫이고, 여기서는 <em>명시적 로그아웃</em>으로 자리가 반납되는
 * 경로를 본다.
 *
 * <p>{@code dev-login-enabled}를 켜는 이유는 이 기능 자체가 그 플래그 뒤에 있기 때문이다
 * (운영 기본값은 false이고, 켜져 있으면 인증 없이 토큰이 나가는 별개의 문제가 된다).
 * 이 프로퍼티 때문에 다른 통합 테스트와는 별도의 애플리케이션 컨텍스트가 뜨는데,
 * {@code PresenceService}가 JVM 힙에만 상태를 두는 싱글턴이라 오히려 격리에 유리하다.
 */
@TestPropertySource(properties = "workflow.demo.dev-login-enabled=true")
class TestAccountConcurrentLoginIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String DEMO_PROJECT = "demo-project";
    private static final String LEADER = "leader";
    private static final String MEMBER = "member1";

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<Session> openSessions = new ArrayList<>();

    private record Session(String accessToken, String sessionId, long userId, String name) {}

    /**
     * 접속 상태는 컨텍스트를 공유하는 싱글턴에 남는다. 반납하지 않으면 다음 테스트의 로그인이
     * 409로 막히고, 그 실패는 "동시 접속 제한이 깨졌다"가 아니라 "앞 테스트가 안 치웠다"인데
     * 메시지만 봐서는 구분되지 않는다.
     */
    @AfterEach
    void releaseSessions() throws Exception {
        for (Session session : openSessions) {
            logout(session);
        }
        openSessions.clear();
    }

    @Test
    void secondLoginIsBlockedWhileTheSameAccountIsAlreadyConnected() throws Exception {
        login(LEADER);

        mockMvc.perform(testLoginRequest(LEADER))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("TEST_ACCOUNT_ALREADY_ACTIVE"));
    }

    @Test
    void otherAccountsAreNotBlockedByAnActiveSession() throws Exception {
        login(LEADER);

        // 차단이 계정 단위인지 전역인지 가른다. tryAcquire가 사용자 구분 없이 잠그도록 바뀌면
        // 시연 중 한 명이 로그인한 순간 나머지 전원이 못 들어온다 - 위 409 테스트만으로는 안 보인다.
        login(MEMBER);
    }

    @Test
    void logoutFreesTheAccountForTheNextLogin() throws Exception {
        Session first = login(LEADER);

        logout(first);
        openSessions.remove(first);

        // 이 재로그인이 앞 테스트의 대조군이다. 없으면 test-login이 아예 망가져 항상 409를 내도
        // 409 단정은 통과한다.
        login(LEADER);
    }

    @Test
    void presenceListsOnlyTheMembersCurrentlyConnected() throws Exception {
        Session leader = login(LEADER);

        assertThat(presenceUserIds(leader)).containsExactly(leader.userId());

        Session member = login(MEMBER);

        // 접속자만 반환하는지 보려면 "붙어 있는 사람이 나온다"로는 부족하다. 필터를 빼고 멤버
        // 전원을 반환해도 그 단정은 통과한다. 붙기 전에는 없다가 붙은 뒤에 생기는 것까지 봐야 한다.
        assertThat(presenceUserIds(leader)).containsExactlyInAnyOrder(leader.userId(), member.userId());
    }

    private Session login(String username) throws Exception {
        JsonNode data = objectMapper.readTree(
            mockMvc.perform(testLoginRequest(username))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()
        ).get("data");

        String sessionId = data.get("testSessionId").asText();
        assertThat(sessionId).as("테스트 로그인은 접속 슬롯을 식별할 sessionId를 줘야 한다").isNotBlank();

        Session session = new Session(
            data.get("accessToken").asText(), sessionId, data.get("user").get("id").asLong(), username);
        openSessions.add(session);
        return session;
    }

    private void logout(Session session) throws Exception {
        mockMvc.perform(post("/api/v1/auth/test-logout")
                .header("Authorization", "Bearer " + session.accessToken())
                .header("X-Workflow-Test-Session-Id", session.sessionId()))
            .andExpect(status().isOk());
    }

    private List<Long> presenceUserIds(Session viewer) throws Exception {
        JsonNode data = objectMapper.readTree(
            mockMvc.perform(get("/api/v1/projects/{projectId}/presence", DEMO_PROJECT)
                    .header("Authorization", "Bearer " + viewer.accessToken()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()
        ).get("data");

        List<Long> userIds = new ArrayList<>();
        data.forEach(entry -> userIds.add(entry.get("userId").asLong()));
        return userIds;
    }

    private MockHttpServletRequestBuilder testLoginRequest(String username) {
        return post("/api/v1/auth/test-login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"username\":\"%s\",\"password\":\"1111\"}".formatted(username));
    }
}
