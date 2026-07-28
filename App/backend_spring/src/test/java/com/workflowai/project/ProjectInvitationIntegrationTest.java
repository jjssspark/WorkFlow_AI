package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * IT-009 초대~수락~접근권한 연계.
 *
 * <p>초대 토큰은 <strong>인증된 아무나가 들고 오면 통하는 값</strong>이다. 수락 엔드포인트에는
 * {@code @PreAuthorize}가 없고(있을 수 없다 - 아직 멤버가 아니어야 하니까), 토큰 문자열 하나가
 * 프로젝트 접근권을 만든다. 그래서 만료·재사용 검사가 이 경로의 유일한 방어선이다.
 *
 * <p>수락 전 403을 함께 보는 이유는 IT-011과 같다. 수락 후 200만 보면 상세 조회가 원래 누구에게나
 * 열려 있어도 통과하고, 그러면 "수락이 무엇을 바꿨는가"는 아무것도 검증되지 않는다.
 *
 * <p><strong>실패 경로가 envelope으로 나오지 않는 것을 현재 상태로 기록한다.</strong>
 * {@code InvitationService}는 만료·재사용을 {@code IllegalStateException}으로 알리는데
 * {@link InvitationController}에도 {@code GlobalExceptionHandler}에도 이를 받는 핸들러가 없다.
 * 클라이언트는 {@code error.code} 없는 500을 받으므로 "만료됐다"와 "서버가 죽었다"를 구분할 수
 * 없다. 바람직한 동작을 고정하는 것이 아니라 지금 그렇다는 사실을 못 박는 것이고, 핸들러가
 * 생기면 이 테스트가 실패하면서 그때 갱신하면 된다(IT-002의 500 경로와 같은 방식).
 */
class ProjectInvitationIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String LEADER_EMAIL = "invite-leader@workflow.test";
    private static final String INVITEE_EMAIL = "invite-invitee@workflow.test";
    private static final String PROJECT_TITLE = "초대 연계 검증 프로젝트";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Account leader;
    private Account invitee;
    private long projectId;

    private record Account(long id, String token) {}

    @BeforeEach
    void seedProject() throws Exception {
        jdbcTemplate.update("DELETE FROM invitations WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);

        leader = createAccount(LEADER_EMAIL, "초대하는 사람");
        invitee = createAccount(INVITEE_EMAIL, "초대받는 사람");

        String body = """
            {"title":"%s","type":"캡스톤디자인","description":"IT-009 검증용"}
            """.formatted(PROJECT_TITLE);
        projectId = dataOf(mockMvc.perform(post("/api/v1/projects")
            .header("Authorization", "Bearer " + leader.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andExpect(status().isOk())).get("id").asLong();
    }

    @Test
    void acceptingAnInvitationIsWhatTurnsTheTokenIntoProjectAccess() throws Exception {
        String token = createInvitation("팀원").get("token").asText();

        detail(invitee).andExpect(status().isForbidden());

        accept(token, invitee).andExpect(status().isOk());

        detail(invitee).andExpect(status().isOk());
        assertThat(roleOf(invitee.id())).isEqualTo("팀원");
    }

    @Test
    void aReviewerInvitationDoesNotSilentlyBecomeATeamMember() throws Exception {
        // 수락 경로가 초대의 역할을 무시하고 늘 MEMBER로 넣어도 "멤버가 됐다"는 단정은 통과한다.
        // 그 버그의 실제 피해는 심사자가 팀원 쓰기 권한을 갖고, 팀원 수·기여도 집계에 섞이는 것이다.
        String token = createInvitation("심사자").get("token").asText();

        accept(token, invitee).andExpect(status().isOk());

        // 심사자도 프로젝트 접근 자체는 된다.
        detail(invitee).andExpect(status().isOk());

        // 하지만 팀원 목록에는 나오지 않는다. 이건 버그가 아니라 설계다
        // (ProjectService#members가 REVIEWER를 걸러낸다). 역할이 MEMBER로 저장됐다면
        // 여기 '팀원'으로 나타나므로, 이 부재 자체가 역할이 지켜졌다는 증거가 된다.
        assertThat(memberUserIds()).doesNotContain(invitee.id());
        assertThat(storedRoleOf(invitee.id())).isEqualTo("REVIEWER");
    }

    @Test
    void onlyLeadersCanIssueInvitations() throws Exception {
        // 초대를 발급할 수 있으면 아무나 자기 자신을 남의 프로젝트에 넣을 수 있다.
        // 이 테스트가 없으면 @PreAuthorize를 지워도 위 테스트들은 그대로 통과한다.
        String token = createInvitation("팀원").get("token").asText();
        accept(token, invitee).andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/projects/{projectId}/invitations", projectId)
                .header("Authorization", "Bearer " + invitee.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"someone@workflow.test\",\"role\":\"팀원\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void expiredInvitationGrantsNothing() throws Exception {
        String token = createInvitation("팀원").get("token").asText();
        jdbcTemplate.update("UPDATE invitations SET expires_at = now() - interval '1 day' WHERE token = ?", token);

        // 처리되지 않은 예외라 MockMvc가 그대로 되던진다. envelope이 없다는 사실 자체의 증거다.
        assertThatThrownBy(() -> accept(token, invitee))
            .hasRootCauseInstanceOf(IllegalStateException.class);

        // 중요한 건 예외 종류가 아니라 이것이다 - 실패했는데 멤버가 만들어져 있으면
        // 화면만 실패로 보이고 접근권은 이미 넘어간 상태가 된다.
        assertThat(memberCount(invitee.id())).isZero();
        detail(invitee).andExpect(status().isForbidden());
    }

    private Account createAccount(String email, String name) {
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", email);
        User user = userRepository.save(new User(email, name, "local", email));
        return new Account(user.getId(), jwtService.issueAccessToken(user));
    }

    private JsonNode createInvitation(String koreanRole) throws Exception {
        return dataOf(mockMvc.perform(post("/api/v1/projects/{projectId}/invitations", projectId)
            .header("Authorization", "Bearer " + leader.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"%s\",\"role\":\"%s\"}".formatted(INVITEE_EMAIL, koreanRole)))
            .andExpect(status().isOk()));
    }

    private ResultActions accept(String token, Account account) throws Exception {
        return mockMvc.perform(post("/api/v1/invitations/{token}/accept", token)
            .header("Authorization", "Bearer " + account.token()));
    }

    private ResultActions detail(Account account) throws Exception {
        return mockMvc.perform(get("/api/v1/projects/{projectId}", projectId)
            .header("Authorization", "Bearer " + account.token()));
    }

    /** 팀장이 멤버 목록 API로 보는 값을 쓴다. DB를 직접 읽으면 응답 매핑이 어긋나도 드러나지 않는다. */
    private String roleOf(long userId) throws Exception {
        for (JsonNode member : memberList()) {
            if (member.get("userId").asLong() == userId) {
                return member.get("role").asText();
            }
        }
        throw new AssertionError("멤버 목록에 userId=" + userId + "가 없습니다: " + memberList());
    }

    private List<Long> memberUserIds() throws Exception {
        List<Long> ids = new ArrayList<>();
        memberList().forEach(member -> ids.add(member.get("userId").asLong()));
        return ids;
    }

    private JsonNode memberList() throws Exception {
        return dataOf(mockMvc.perform(get("/api/v1/projects/{projectId}/members", projectId)
            .header("Authorization", "Bearer " + leader.token()))
            .andExpect(status().isOk()));
    }

    /** 역할이 실제로 무엇으로 저장됐는지. 멤버 목록에 안 나오는 심사자는 이 경로로만 확인된다. */
    private String storedRoleOf(long userId) {
        return jdbcTemplate.queryForObject(
            "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
            String.class, projectId, userId);
    }

    private int memberCount(long userId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM project_members WHERE project_id = ? AND user_id = ?",
            Integer.class, projectId, userId);
        return count == null ? 0 : count;
    }

    private JsonNode dataOf(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString()).get("data");
    }
}
