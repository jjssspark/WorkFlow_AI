package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
 * IT-008 프로젝트 생성~멤버쉽~목록 / IT-010 역할 변경 후 권한 반영 / IT-011 초대 코드 참여.
 *
 * <p>세 케이스가 한 클래스에 있는 이유는 검증 대상이 같기 때문이다 - {@code project_members}에
 * 쓰인 역할이 {@link com.workflowai.security.ProjectAccess}의 인가 판정에 <strong>즉시</strong>
 * 반영되는가. 쓰는 쪽과 읽는 쪽이 다른 요청, 다른 트랜잭션이라 서비스 단위 테스트로는 닿지 않는다.
 *
 * <p>가장 밟기 쉬운 함정이 <em>검증하려는 조건 외의 것이 답을 결정해버리는</em> 경우다.
 *
 * <ul>
 *   <li>IT-010을 "팀원을 심사자로 바꾸면 프로젝트 수정이 막힌다"로 짜면 무의미하다.
 *       팀원은 <strong>바꾸기 전에도</strong> 수정할 수 없다(LEADER 전용). 역할 변경을
 *       통째로 지워도 통과한다. 그래서 팀장으로 올려 수정이 되는 것을 먼저 확인한 뒤,
 *       심사자로 내려 막히는 것을 본다.
 *   <li>IT-008에서 목록에 나오는 것만 보면 {@code findAll()}로 바뀌어도 통과한다.
 *       비멤버의 목록에는 없다는 것까지 봐야 "멤버십 기준 조회"가 검증된다.
 * </ul>
 *
 * <p><strong>시트 예상결과와 구현이 다른 지점 두 곳을 실제 동작대로 고정했다.</strong>
 * 생성 응답은 201이 아니라 200이고, 초대 코드 중복 참여는 오류가 아니라 멱등 처리다
 * ({@code ProjectService#joinByCode}에 의도된 동작으로 명시돼 있다).
 */
class ProjectMembershipIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String OWNER_EMAIL = "membership-owner@workflow.test";
    private static final String JOINER_EMAIL = "membership-joiner@workflow.test";
    private static final String OUTSIDER_EMAIL = "membership-outsider@workflow.test";
    private static final String PROJECT_TITLE = "멤버십 연계 검증 프로젝트";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Account owner;
    private Account joiner;
    private Account outsider;

    private record Account(long id, String token) {}

    @BeforeEach
    void seedAccounts() {
        jdbcTemplate.update("DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);

        owner = createAccount(OWNER_EMAIL, "생성자");
        joiner = createAccount(JOINER_EMAIL, "참여자");
        outsider = createAccount(OUTSIDER_EMAIL, "외부인");
    }

    @Test
    void creatorBecomesLeaderAndSeesTheProjectInTheirOwnListOnly() throws Exception {
        long projectId = createProject().get("id").asLong();

        assertThat(projectIdsVisibleTo(owner)).contains(projectId);
        assertThat(roleOf(projectId, owner, owner.id())).isEqualTo("팀장");

        // 대조군. 이게 없으면 목록 조회가 findAll()로 바뀌어도 위 단정은 통과한다.
        assertThat(projectIdsVisibleTo(outsider)).doesNotContain(projectId);
    }

    @Test
    void joiningWithTheInviteCodeGrantsMemberAccess() throws Exception {
        JsonNode project = createProject();
        long projectId = project.get("id").asLong();

        // 참여 전에는 상세 조회가 막혀야 한다. 참여 후 200만 보면 애초에 누구나 볼 수 있는
        // 엔드포인트여도 통과하므로, 참여가 무엇을 바꿨는지가 드러나지 않는다.
        detail(projectId, joiner).andExpect(status().isForbidden());

        join(joiner, project.get("inviteCode").asText()).andExpect(status().isOk());

        detail(projectId, joiner).andExpect(status().isOk());
        assertThat(roleOf(projectId, owner, joiner.id())).isEqualTo("팀원");
        assertThat(projectIdsVisibleTo(joiner)).contains(projectId);
    }

    @Test
    void unknownInviteCodeIsRejectedAndJoiningTwiceIsIdempotent() throws Exception {
        JsonNode project = createProject();
        long projectId = project.get("id").asLong();
        String code = project.get("inviteCode").asText();

        join(joiner, "NOSUCHCD")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_INVITE_CODE"));

        join(joiner, code).andExpect(status().isOk());
        join(joiner, code).andExpect(status().isOk());

        // 시트의 "중복 참여는 오류로 거부된다"와 다르다. 구현은 의도적으로 멱등이며
        // (ProjectService#joinByCode 주석), 여기서 확인할 것은 오류 여부가 아니라
        // 멤버 행이 두 번 생기지 않는 것이다 - 그게 생기면 인원수·집계가 전부 어긋난다.
        assertThat(memberCount(projectId, joiner.id())).isEqualTo(1);
    }

    @Test
    void roleChangeTakesEffectOnTheNextAuthorizationCheck() throws Exception {
        long projectId = createProject().get("id").asLong();
        join(joiner, inviteCodeOf(projectId)).andExpect(status().isOk());

        changeRole(projectId, joiner.id(), "팀장").andExpect(status().isOk());
        // 먼저 "할 수 있었다"를 증명한다. 이 단정이 없으면 아래 403이 역할 변경 때문인지
        // 원래부터 막혀 있었기 때문인지 구분되지 않는다.
        renameProject(projectId, joiner, "팀장 권한으로 수정").andExpect(status().isOk());

        changeRole(projectId, joiner.id(), "심사자").andExpect(status().isOk());

        renameProject(projectId, joiner, "심사자가 되면 막혀야 한다")
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    private Account createAccount(String email, String name) {
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", email);
        User user = userRepository.save(new User(email, name, "local", email));
        return new Account(user.getId(), jwtService.issueAccessToken(user));
    }

    private JsonNode createProject() throws Exception {
        String body = """
            {"title":"%s","type":"캡스톤디자인","description":"IT-008 검증용"}
            """.formatted(PROJECT_TITLE);
        return dataOf(mockMvc.perform(post("/api/v1/projects")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andExpect(status().isOk()));
    }

    private ResultActions join(Account account, String code) throws Exception {
        return mockMvc.perform(post("/api/v1/projects/join")
            .header("Authorization", "Bearer " + account.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"code\":\"%s\"}".formatted(code)));
    }

    private ResultActions detail(long projectId, Account account) throws Exception {
        return mockMvc.perform(get("/api/v1/projects/{projectId}", projectId)
            .header("Authorization", "Bearer " + account.token()));
    }

    private ResultActions changeRole(long projectId, long userId, String koreanRole) throws Exception {
        return mockMvc.perform(patch("/api/v1/projects/{projectId}/members/{userId}/role", projectId, userId)
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"role\":\"%s\"}".formatted(koreanRole)));
    }

    private ResultActions renameProject(long projectId, Account account, String title) throws Exception {
        return mockMvc.perform(patch("/api/v1/projects/{projectId}", projectId)
            .header("Authorization", "Bearer " + account.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"title\":\"%s\"}".formatted(title)));
    }

    private String inviteCodeOf(long projectId) throws Exception {
        return dataOf(detail(projectId, owner).andExpect(status().isOk())).get("inviteCode").asText();
    }

    private List<Long> projectIdsVisibleTo(Account account) throws Exception {
        JsonNode data = dataOf(mockMvc.perform(get("/api/v1/projects")
            .header("Authorization", "Bearer " + account.token()))
            .andExpect(status().isOk()));
        List<Long> ids = new ArrayList<>();
        data.forEach(project -> ids.add(project.get("id").asLong()));
        return ids;
    }

    private String roleOf(long projectId, Account viewer, long userId) throws Exception {
        JsonNode members = dataOf(mockMvc.perform(get("/api/v1/projects/{projectId}/members", projectId)
            .header("Authorization", "Bearer " + viewer.token()))
            .andExpect(status().isOk()));
        for (JsonNode member : members) {
            if (member.get("userId").asLong() == userId) {
                return member.get("role").asText();
            }
        }
        throw new AssertionError("멤버 목록에 userId=" + userId + "가 없습니다: " + members);
    }

    private int memberCount(long projectId, long userId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM project_members WHERE project_id = ? AND user_id = ?",
            Integer.class, projectId, userId);
        return count == null ? 0 : count;
    }

    private JsonNode dataOf(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString()).get("data");
    }
}
