package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * IT-025 실시간 알림 발행~수신~읽음 연계.
 *
 * <p>넛지 한 번이 만드는 경로는 요청 스레드 하나로 끝나지 않는다.
 *
 * <pre>
 *   요청 스레드   TaskController → notifyAfterCommit (등록만 하고 반환)
 *                        ↓ 원 트랜잭션 커밋
 *   afterCommit  asyncSender.sendAsync 제출
 *                        ↓
 *   별도 스레드   REQUIRES_NEW 트랜잭션으로 저장 → 커밋 → broadcaster.broadcast
 *                        ↓
 *   SSE          구독 중인 emitter로 push
 * </pre>
 *
 * <p>세 스레드와 두 트랜잭션을 건너간다. 단위 테스트는 이 경계를 전부 목으로 지워버리므로,
 * "알림이 저장은 되는데 화면에는 안 뜬다" 또는 그 반대인 상태를 잡지 못한다.
 *
 * <p><strong>이 테스트가 잡지 못하는 것을 먼저 적어 둔다.</strong> {@code NotificationAsyncSender}는
 * 저장이 커밋된 <em>뒤에</em> broadcast하도록 되어 있고 그 이유가 주석에 적혀 있다 - 순서가
 * 뒤집히면 push를 받은 클라이언트가 곧바로 목록을 불러왔을 때 방금 받은 알림이 없다. 그런데
 * broadcast를 트랜잭션 <em>안으로</em> 옮기는 변이를 걸어도 이 테스트를 포함해 아무것도 실패하지
 * 않는다. 테스트가 SSE 본문을 읽고 조회를 던지는 사이에 커밋이 이미 끝나 경쟁 구간을 못 본다.
 * 이걸 잡으려면 커밋을 붙잡아 두는 훅이 필요한데, 그건 운영 코드에 테스트용 구멍을 내는 일이라
 * 하지 않았다. 대신 잡지 못한다는 사실을 여기 남긴다.
 *
 * <p>그래서 아래 "수신 시점에 조회된다" 단정이 실제로 막는 것은 순서가 아니라 <em>저장 없이
 * broadcast만 하는</em> 경우다. 그것도 실제로 일어날 수 있는 형태이므로 단정 자체는 남겨 둔다.
 *
 * <p>대기는 시간이 아니라 조건으로 한다. 고정 sleep은 빠를 땐 낭비고 CI가 느린 날엔 부족한데,
 * 무엇보다 실패 메시지가 "알림이 안 왔다"가 아니라 그 다음 줄의 엉뚱한 단정으로 나타난다.
 */
class NotificationRealtimeIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String LEADER_EMAIL = "realtime-leader@workflow.test";
    private static final String ASSIGNEE_EMAIL = "realtime-assignee@workflow.test";
    private static final String PROJECT_TITLE = "실시간 알림 검증 프로젝트";
    private static final String TASK_TITLE = "알림 연계 검증 업무";
    private static final Duration PUSH_TIMEOUT = Duration.ofSeconds(10);

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
    private Account assignee;
    private long projectId;
    private long taskId;

    private record Account(long id, String token) {}

    @BeforeEach
    void seedProjectWithAssignedTask() {
        jdbcTemplate.update("DELETE FROM notifications WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);

        leader = createAccount(LEADER_EMAIL, "팀장");
        assignee = createAccount(ASSIGNEE_EMAIL, "담당자");

        projectId = insert("INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            PROJECT_TITLE, leader.id());
        jdbcTemplate.update("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'LEADER')",
            projectId, leader.id());
        jdbcTemplate.update("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'MEMBER')",
            projectId, assignee.id());

        taskId = insert(
            "INSERT INTO tasks (project_id, title, category, status, assignee_id, priority, created_by) "
                + "VALUES (?, ?, 'backend', 'inprogress', ?, 'medium', ?) RETURNING id",
            projectId, TASK_TITLE, assignee.id(), leader.id());
    }

    @Test
    void nudgeReachesTheAssigneeOverSseAndIsAlreadyQueryableWhenItArrives() throws Exception {
        MvcResult stream = openStream(assignee);

        nudge("URGENT").andExpect(status().isOk());

        String pushed = awaitPush(stream);
        assertThat(pushed).contains("TASK_NUDGE").contains(TASK_TITLE);

        // push된 알림이 조회에도 잡히는지. 커밋/broadcast의 '순서'는 이걸로 검증되지 않는다
        // (클래스 주석 참고). 여기서 막히는 것은 저장 없이 push만 나가는 경우다.
        assertThat(unreadCount(assignee)).isEqualTo(1);
    }

    @Test
    void readingTheNotificationBringsTheUnreadCountBackDown() throws Exception {
        assertThat(unreadCount(assignee)).isZero();

        nudge("START").andExpect(status().isOk());
        await().atMost(PUSH_TIMEOUT).until(() -> unreadCount(assignee) == 1);

        markRead(assignee, notificationIdOf(assignee)).andExpect(status().isOk());

        assertThat(unreadCount(assignee)).isZero();
    }

    @Test
    void theSenderDoesNotNotifyThemselves() throws Exception {
        // 팀장은 자기가 방금 누른 결과를 화면에서 이미 보고 있다. 이 대조군이 없으면
        // "관련된 사람 전원에게 보낸다"는 구현으로 바뀌어도 위 테스트들은 그대로 통과한다.
        nudge("PROGRESS").andExpect(status().isOk());
        await().atMost(PUSH_TIMEOUT).until(() -> unreadCount(assignee) == 1);

        assertThat(unreadCount(leader)).isZero();
    }

    @Test
    void oneUserCannotMarkAnotherUsersNotificationAsRead() throws Exception {
        nudge("URGENT").andExpect(status().isOk());
        await().atMost(PUSH_TIMEOUT).until(() -> unreadCount(assignee) == 1);
        long assigneeNotificationId = notificationIdOf(assignee);

        // 읽음 처리는 id 목록만 받는다. 소유자 검사가 없으면 남의 알림 뱃지를 임의로 꺼버릴 수 있다.
        // 조용히 무시하는 것이 현재 구현이라 응답은 200이고, 효과가 없다는 것으로만 확인된다.
        markRead(leader, assigneeNotificationId).andExpect(status().isOk());

        assertThat(unreadCount(assignee)).isEqualTo(1);
    }

    private MvcResult openStream(Account account) throws Exception {
        return mockMvc.perform(get("/api/v1/notifications/stream")
                .header("Authorization", "Bearer " + account.token()))
            .andExpect(request().asyncStarted())
            .andReturn();
    }

    private String awaitPush(MvcResult stream) {
        await().atMost(PUSH_TIMEOUT).until(() -> !streamContent(stream).isBlank());
        return streamContent(stream);
    }

    /**
     * 바이트로 읽어 UTF-8로 직접 디코딩한다. {@code getContentAsString()}을 쓰면 한글이 깨진다 -
     * {@code text/event-stream}에는 charset 파라미터가 붙지 않아 응답 인코딩이 서블릿 기본값
     * (ISO-8859-1)으로 남기 때문이다. 운영에서는 문제가 되지 않는다. EventSource 규격이 본문을
     * 항상 UTF-8로 읽도록 정하고 있어 브라우저는 Content-Type의 charset을 보지 않는다.
     */
    private String streamContent(MvcResult stream) {
        return new String(stream.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private org.springframework.test.web.servlet.ResultActions nudge(String kind) throws Exception {
        return mockMvc.perform(post("/api/v1/projects/{projectId}/tasks/{taskId}/nudge", projectId, taskId)
            .header("Authorization", "Bearer " + leader.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"kind\":\"%s\"}".formatted(kind)));
    }

    private org.springframework.test.web.servlet.ResultActions markRead(Account account, long notificationId)
        throws Exception {
        return mockMvc.perform(patch("/api/v1/notifications/read")
            .header("Authorization", "Bearer " + account.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"ids\":[%d]}".formatted(notificationId)));
    }

    private long unreadCount(Account account) {
        try {
            JsonNode data = objectMapper.readTree(
                mockMvc.perform(get("/api/v1/notifications/unread-count")
                        .param("projectId", String.valueOf(projectId))
                        .header("Authorization", "Bearer " + account.token()))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString()
            ).get("data");
            return data.get("count").asLong();
        } catch (Exception e) {
            throw new IllegalStateException("미읽음 개수를 조회할 수 없습니다.", e);
        }
    }

    private long notificationIdOf(Account account) throws Exception {
        JsonNode list = objectMapper.readTree(
            mockMvc.perform(get("/api/v1/notifications")
                    .param("projectId", String.valueOf(projectId))
                    .header("Authorization", "Bearer " + account.token()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()
        ).get("data");
        assertThat(list).as("알림 목록이 비어 있습니다").isNotEmpty();
        return list.get(0).get("id").asLong();
    }

    private Account createAccount(String email, String name) {
        jdbcTemplate.update("DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ?)", email);
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
