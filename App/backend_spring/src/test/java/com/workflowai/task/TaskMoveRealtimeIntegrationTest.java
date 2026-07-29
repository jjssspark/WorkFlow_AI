package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 칸반 이동이 커밋되면 같은 프로젝트의 다른 구성원에게 실시간으로 반영되는지 검증한다.
 *
 * <p>{@code TaskControllerPositionTest}는 Mockito 목이라 SSE 배송 자체를 검증하지 못하고,
 * {@code TaskPositionConcurrencyIntegrationTest}는 잠금/트랜잭션만 본다. 여기서는 실제
 * Postgres+Redis 위에서 두 사용자가 각자 SSE를 구독한 채로, 한쪽이 이동하면 다른 쪽에만
 * {@code task-move} 프레임이 오고 행위자 본인에게는 오지 않는지 확인한다.
 */
class TaskMoveRealtimeIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String LEADER_EMAIL = "task-move-leader@workflow.test";
    private static final String MEMBER_EMAIL = "task-move-member@workflow.test";
    private static final String PROJECT_TITLE = "실시간 이동 동기화 검증 프로젝트";
    private static final Duration PUSH_TIMEOUT = Duration.ofSeconds(10);

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private record Account(long id, String token) {}

    private Account leader;
    private Account member;
    private long projectId;
    private long taskId;

    @BeforeEach
    void seedProjectWithTask() {
        jdbcTemplate.update(
            "DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE title = ?)", PROJECT_TITLE);
        jdbcTemplate.update(
            "DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);

        leader = createAccount(LEADER_EMAIL, "팀장");
        member = createAccount(MEMBER_EMAIL, "팀원");

        projectId = insert(
            "INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            PROJECT_TITLE, leader.id());
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'LEADER')",
            projectId, leader.id());
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'MEMBER')",
            projectId, member.id());

        taskId = insert(
            "INSERT INTO tasks (project_id, title, category, status, assignee_id, priority, created_by, position) "
                + "VALUES (?, '이동 동기화 검증 업무', 'backend', 'todo', ?, 'medium', ?, 0) RETURNING id",
            projectId, member.id(), leader.id());
    }

    @Test
    void bystanderReceivesTaskMoveEventButActorDoesNot() throws Exception {
        MvcResult memberStream = openStream(member);
        MvcResult leaderStream = openStream(leader);

        movePosition(leader, "inprogress", 1.0).andExpect(status().isOk());

        String pushedToMember = awaitPush(memberStream, "task-move");
        assertThat(pushedToMember).contains("task-move").contains(String.valueOf(taskId)).contains("inprogress");

        // 액터(leader) 본인은 이미 낙관적으로 반영했으므로 이 이벤트를 받지 않아야 한다.
        // member에게 push가 도착했다는 것은 같은 after-commit 팬아웃 라운드가 끝났다는 뜻이므로
        // 추가 대기 없이 바로 확인한다.
        assertThat(streamContent(leaderStream)).doesNotContain("task-move");
    }

    private MvcResult openStream(Account account) throws Exception {
        return mockMvc.perform(get("/api/v1/notifications/stream")
                .header("Authorization", "Bearer " + account.token()))
            .andExpect(request().asyncStarted())
            .andReturn();
    }

    private String awaitPush(MvcResult stream, String expectedSubstring) {
        await().atMost(PUSH_TIMEOUT).until(() -> streamContent(stream).contains(expectedSubstring));
        return streamContent(stream);
    }

    private String streamContent(MvcResult stream) {
        return new String(stream.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private ResultActions movePosition(Account account, String status, double position) throws Exception {
        return mockMvc.perform(patch("/api/v1/projects/{projectId}/tasks/{taskId}/position", projectId, taskId)
            .header("Authorization", "Bearer " + account.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"status\":\"%s\",\"position\":%s}".formatted(status, position)));
    }

    private Account createAccount(String email, String name) {
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", email);
        User user = userRepository.save(new User(email, name, "local", email));
        return new Account(user.getId(), jwtService.issueAccessToken(user));
    }

    private long insert(String sql, Object... args) {
        Long id = jdbcTemplate.queryForObject(sql, Long.class, args);
        if (id == null) {
            throw new IllegalStateException("INSERT가 id를 반환하지 않았습니다: " + sql);
        }
        return id;
    }
}
