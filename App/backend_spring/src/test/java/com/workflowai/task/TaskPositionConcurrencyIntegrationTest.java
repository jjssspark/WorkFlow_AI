package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;

import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * IT-XXX 업무 상태 이동 동시 요청 - 실제 Postgres 비관적 잠금 검증.
 *
 * <p>{@link TaskControllerPositionTest#repeatedMoveToSameStatusCreatesOnlyOneLeaderNotification}은
 * {@code @Mock TaskRepository}를 같은 스레드에서 순차 호출한다. 그 테스트가 통과한다고 해서
 * {@code findByIdForUpdate}의 {@code PESSIMISTIC_WRITE}가 실제로 두 트랜잭션을 직렬화하는지,
 * 그 직렬화가 실제 Postgres 행 잠금에서 나오는지는 증명되지 않는다 - 목은 애초에 동시에 실행되지 않는다.
 *
 * <p>이 테스트는 보안 필터 체인·실제 트랜잭션·실제 Postgres가 모두 살아있는 {@link PostgresRedisIntegrationTest}
 * 위에서, 같은 업무를 노리는 두 요청을 스레드 2개 + {@link CountDownLatch}로 진짜 동시에 실행한다.
 * 잠금이 없거나 호출 경로에 트랜잭션이 없다면 두 요청이 같은 이전 상태를 동시에 읽어 상태변경 알림이
 * 두 번 나가거나(TaskRepository 주석이 막으려는 바로 그 경쟁 상태), 트랜잭션 없이 잠금 쿼리를 실행해
 * 예외가 날 수 있다. 이 테스트는 그 두 가지 실패 모드가 실제로 일어나지 않는다는 것을 확인한다.
 */
class TaskPositionConcurrencyIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String PROJECT_TITLE = "task-concurrency-project";
    private static final String LEADER_EMAIL = "task-concurrency-leader@workflow.test";
    private static final String ASSIGNEE_EMAIL = "task-concurrency-assignee@workflow.test";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private NotificationService notificationService;

    private String leaderToken;
    private long assigneeId;
    private long projectId;
    private long taskId;

    @BeforeEach
    void seedProjectAndTask() {
        cleanUpPreviousRun();

        long leaderId = createUser(LEADER_EMAIL, "동시성 검증 팀장");
        assigneeId = createUser(ASSIGNEE_EMAIL, "동시성 검증 담당자");
        leaderToken = jwtService.issueAccessToken(userRepository.findById(leaderId).orElseThrow());

        projectId = insertProject(PROJECT_TITLE, leaderId);
        projectMemberRepository.save(new ProjectMember(projectId, leaderId, ProjectRole.LEADER));
        projectMemberRepository.save(new ProjectMember(projectId, assigneeId, ProjectRole.MEMBER));

        taskId = taskRepository.save(new Task(
            projectId, "동시성 검증 업무", "frontend", "todo", assigneeId,
            LocalDate.now().plusDays(3), "medium", "설명", "MANUAL", null, leaderId, 0.0
        )).getId();
    }

    @Test
    void concurrentMovesToTheSameStatusAreSerializedAndNotifyOnlyOnce() throws Exception {
        int requestCount = 2;
        ExecutorService executor = Executors.newFixedThreadPool(requestCount);
        CountDownLatch ready = new CountDownLatch(requestCount);
        CountDownLatch start = new CountDownLatch(1);

        Callable<Integer> moveToInProgress = () -> {
            ready.countDown();
            // 두 요청이 findByIdForUpdate에 정말로 동시에 진입하도록, 시작 신호가 오기 전까지 대기시킨다.
            // 신호 없이 순서대로 제출하면 첫 요청이 끝나고서야 두 번째가 시작될 수 있어 경쟁 자체가 안 생긴다.
            assertThat(start.await(10, TimeUnit.SECONDS)).as("시작 신호를 제 시간에 받아야 한다").isTrue();
            return mockMvc.perform(patch("/api/v1/projects/{projectId}/tasks/{taskId}/position",
                    String.valueOf(projectId), taskId)
                    .header("Authorization", "Bearer " + leaderToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"inprogress\",\"position\":1.0}"))
                .andReturn().getResponse().getStatus();
        };

        List<Future<Integer>> futures;
        try {
            futures = List.of(executor.submit(moveToInProgress), executor.submit(moveToInProgress));
            assertThat(ready.await(10, TimeUnit.SECONDS)).as("두 요청이 모두 대기 상태에 들어가야 한다").isTrue();
            start.countDown();
        } finally {
            executor.shutdown();
        }

        // 잠금이 없거나 호출 경로에 트랜잭션이 없다면 여기서 TransactionRequiredException/타임아웃으로 실패한다.
        for (Future<Integer> future : futures) {
            assertThat(future.get(15, TimeUnit.SECONDS)).isEqualTo(200);
        }

        assertThat(taskRepository.findById(taskId).orElseThrow().getStatus()).isEqualTo("inprogress");
        // 직렬화된 두 번째 요청은 이미 바뀐 상태를 읽으므로, 실제 동시 실행에서도 알림은 한 번만 나가야 한다.
        verify(notificationService, times(1)).notifyAfterCommit(
            eq(assigneeId), eq(projectId), eq("STATUS_CHANGED"), any(), any(), eq("task"), eq(taskId)
        );
    }

    private long createUser(String email, String name) {
        return userRepository.save(new User(email, name, "local", email)).getId();
    }

    private long insertProject(String title, long createdBy) {
        Long id = jdbcTemplate.queryForObject(
            "INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            Long.class, title, createdBy
        );
        if (id == null) {
            throw new IllegalStateException("프로젝트 생성 실패: " + title);
        }
        return id;
    }

    /** 컨테이너를 클래스 간에 공유하므로 앞선 실행이 남긴 행을 직접 치운다. */
    private void cleanUpPreviousRun() {
        jdbcTemplate.update(
            "DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE title = ?)", PROJECT_TITLE
        );
        jdbcTemplate.update(
            "DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title = ?)",
            PROJECT_TITLE
        );
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);
        jdbcTemplate.update("DELETE FROM users WHERE email IN (?, ?)", LEADER_EMAIL, ASSIGNEE_EMAIL);
    }
}
