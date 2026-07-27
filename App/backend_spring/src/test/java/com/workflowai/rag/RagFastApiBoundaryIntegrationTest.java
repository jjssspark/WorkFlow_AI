package com.workflowai.rag;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * IT-031 비멤버 RAG 차단 연계 / IT-042 색인 실패~intent 기록~복구 연계.
 *
 * <p>여기까지의 테스트는 전부 {@link FastApiRagClient}를 목으로 뒀다. 목은 "이 목을 통과한
 * 호출"만 보여준다. 그래서 두 가지를 물어볼 수 없었다.
 *
 * <ul>
 *   <li>IT-031 - "FastAPI에 <b>아무 요청도 가지 않았다</b>"는 것. {@code verify(never())}는 목을
 *       우회하는 경로(다른 클라이언트, RestClient 직접 사용, 워밍업 호출)를 보지 못한다. 케이스
 *       명세가 "액세스 로그로 확인"이라고 적은 것이 정확히 이 구분이다.
 *   <li>IT-042 - "intent가 <b>커밋됐다</b>"는 것. 목 리포지토리는 롤백되지 않으므로, 색인 실패와
 *       본 트랜잭션의 생존이 갈리는 지점 자체가 존재하지 않는다.
 * </ul>
 *
 * <p>그래서 FastAPI 자리에 JDK 내장 HttpServer를 세우고 {@code workflow.ai.base-url}을 그쪽으로
 * 돌린다. Spring 컨텍스트·보안 필터 체인·Postgres·Redis·트랜잭션·@Async는 전부 실물이고,
 * 대역은 FastAPI 하나뿐이다. 그 대역은 수신한 요청을 전부 기록하고, 실패 응답을 테스트가 조종한다.
 *
 * <p>FastAPI 컨테이너를 쓰지 않는 이유: 이 두 케이스에 임베딩 모델도 LLM도 관여하지 않는다.
 * 필요한 것은 "요청이 왔는가"와 "5xx를 돌려준다"뿐이라 수 GB 이미지를 띄울 값어치가 없다.
 * 실제 모델이 필요한 IT-039·IT-032의 나머지 구간은 이 테스트의 범위 밖이다.
 */
class RagFastApiBoundaryIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String QUERY_PATH = "/api/v1/ai/rag/query";
    private static final String FASTAPI_QUERY_PATH = "/ai/rag/query";
    private static final String FASTAPI_INGEST_PATH = "/ai/rag/ingest";
    private static final String OUTBOX_TABLE = "rag_assignee_sync_failures";
    private static final int INGEST_RETRY_ATTEMPTS = 3;

    private static final List<RecordedRequest> RECEIVED = Collections.synchronizedList(new ArrayList<>());
    private static final AtomicBoolean INGEST_FAILS = new AtomicBoolean(false);
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static HttpServer standInFastApi;

    /** 대역이 실제로 받아낸 요청. Spring이 무엇을 보냈는지(또는 보내지 않았는지)의 유일한 증거다. */
    private record RecordedRequest(String path, String body) {}

    @DynamicPropertySource
    static void pointSpringAtTheStandIn(DynamicPropertyRegistry registry) {
        startStandInFastApi();
        registry.add("workflow.ai.base-url", () -> "http://127.0.0.1:" + standInFastApi.getAddress().getPort());
        // 기본 백오프는 1초·2배라 재시도 3회를 소진하는 데 3초가 걸린다. 검증 대상은 대기 시간이 아니다.
        registry.add("rag.assignee-sync.retry.delay-ms", () -> "1");
        registry.add("rag.assignee-sync.retry.multiplier", () -> "1");
        // @Scheduled 재처리가 테스트 도중에 끼어들면 intent 행이 임의 시점에 사라져 결과가 흔들린다.
        // 복구는 테스트가 직접 replayFailures()를 불러 통제한다.
        registry.add("rag.failure-replay.initial-delay-ms", () -> "3600000");
    }

    private static synchronized void startStandInFastApi() {
        if (standInFastApi != null) {
            return;
        }
        try {
            // 포트 0은 커널이 빈 포트를 고르게 한다. 8000 고정이면 로컬에 실제로 뜬 FastAPI와 충돌한다.
            standInFastApi = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new UncheckedIOException("대역 FastAPI를 띄우지 못했습니다.", e);
        }
        standInFastApi.createContext("/ai/rag", RagFastApiBoundaryIntegrationTest::handle);
        standInFastApi.start();
        // 컨테이너와 같은 이유로 명시적으로 정지하지 않는다. 컨텍스트가 캐시되어 살아 있는 동안
        // 계속 필요하고, JVM이 끝나면 데몬 스레드와 함께 사라진다.
    }

    private static void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        RECEIVED.add(new RecordedRequest(
            path, new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)
        ));

        if (FASTAPI_INGEST_PATH.equals(path) && INGEST_FAILS.get()) {
            // FastAPI 장애를 500으로 흉내낸다. RestClient의 retrieve()가 RestClientException을 던지고,
            // RagIngestService의 @Retryable이 이를 받아 재시도에 들어간다.
            respond(exchange, 500, "{\"detail\":\"stand-in failure\"}");
            return;
        }
        if (FASTAPI_INGEST_PATH.equals(path)) {
            respond(exchange, 200, "{\"chunk_ids\":[1],\"chunk_count\":1}");
            return;
        }
        if (FASTAPI_QUERY_PATH.equals(path)) {
            respond(exchange, 200, "{\"answer\":\"대역 답변\",\"sources\":[]}");
            return;
        }
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private RagIngestService ragIngestService;

    @Autowired
    @Qualifier("ragIngestExecutor")
    private Executor ragIngestExecutor;

    private String leaderToken;
    private String strangerToken;
    private long leaderId;
    private long projectId;

    @BeforeEach
    void resetStandInAndSeedProject() {
        // 앞 테스트가 띄운 @Async 색인이 아직 재시도 중일 수 있다. 그 요청이 이번 테스트의 기록에
        // 섞이면 "FastAPI에 아무것도 가지 않았다"는 단정이 무작위로 깨진다. 실제로 처음 실행했을 때
        // 앞 테스트의 ingest가 다음 테스트 기록에 나타나 실패했다. 실행기가 비는 것을 먼저 기다린다.
        awaitIngestWorkerIdle();
        RECEIVED.clear();
        INGEST_FAILS.set(false);
        // 아웃박스는 전역이고 replayFailures()도 전역을 훑는다. 앞 테스트가 남긴 행이 있으면
        // 복구 테스트가 남의 intent까지 처리해 결과가 뒤섞인다.
        jdbcTemplate.update("DELETE FROM " + OUTBOX_TABLE);

        cleanUpPreviousRun();
        leaderId = createUser("rag-boundary-leader@workflow.test", "경계 검증 팀장");
        long strangerId = createUser("rag-boundary-stranger@workflow.test", "비멤버");
        leaderToken = jwtService.issueAccessToken(userRepository.findById(leaderId).orElseThrow());
        strangerToken = jwtService.issueAccessToken(userRepository.findById(strangerId).orElseThrow());

        projectId = insertProject("rag-boundary-project");
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'LEADER')",
            projectId, leaderId
        );
    }

    @Test
    void nonMemberQueryIsBlockedBeforeAnythingReachesFastApi() throws Exception {
        mockMvc.perform(ragQuery(strangerToken, "남의 프로젝트 내용 알려줘", null))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        // 목의 verify(never())와 달리, 이건 "어떤 경로로도 나가지 않았다"를 말한다.
        assertThat(RECEIVED).isEmpty();
    }

    @Test
    void memberQueryDoesReachFastApiSoTheBlockedCaseIsAboutAuthorization() throws Exception {
        // 대조군이 없으면 위 테스트는 "base-url이 틀려서 아무것도 안 갔다"와 구분되지 않는다.
        mockMvc.perform(ragQuery(leaderToken, "우리 프로젝트 내용 알려줘", null))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.answer").value("대역 답변"));

        assertThat(RECEIVED).singleElement()
            .satisfies(request -> assertThat(request.path()).isEqualTo(FASTAPI_QUERY_PATH));
    }

    @Test
    void forwardedQuestionCarriesTheAuthenticatedUserIdNotTheOneInTheRequestBody() throws Exception {
        // RagController가 요청 바디의 user_id를 버리고 인증 세션 값으로 덮어쓴다. 이걸 놓치면
        // 아무나 남의 user_id를 실어 "그 사람이 담당한 업무"를 조회할 수 있다. 목 인자 검증은
        // 이미 있지만(RagControllerTest), 실제로 나간 JSON에서 확인하는 건 여기가 처음이다.
        long spoofedUserId = 999_999L;

        mockMvc.perform(ragQuery(leaderToken, "내가 맡은 업무 알려줘", spoofedUserId))
            .andExpect(status().isOk());

        Map<String, Object> forwarded = bodyOf(onlyRequest());
        assertThat(forwarded.get("user_id")).isEqualTo((int) leaderId);
        assertThat(forwarded.get("user_id")).isNotEqualTo((int) spoofedUserId);
        // FastAPI RagQueryRequest(chat_schema.py)가 선언한 필드. 이름이 어긋나면 422다.
        assertThat(forwarded.keySet()).isEqualTo(Set.of("project_id", "question", "user_id", "history"));
    }

    @Test
    void ingestFailureKeepsTheBusinessTransactionCommittedAndLeavesAnIntentBehind() throws Exception {
        INGEST_FAILS.set(true);
        String title = "색인 실패 검증 업무";

        long taskId = createTaskAsLeader(title);

        // 재시도가 전부 소진될 때까지 기다린다. 이 지점 이전에 단정하면 아직 진행 중인 색인을
        // "실패했다"고 오판할 수 있다.
        await().atMost(Duration.ofSeconds(10))
            .until(() -> countReceived(FASTAPI_INGEST_PATH) >= INGEST_RETRY_ATTEMPTS);

        // 본 트랜잭션은 색인 실패와 무관하게 살아남아야 한다. 여기가 IT-042의 핵심이다.
        assertThat(taskExists(taskId)).isTrue();

        // 그리고 재색인 근거가 아웃박스에 커밋된 채로 남아야 한다. 이 행이 없으면 복구할 방법이 없다.
        assertThat(intentContentFor(taskId)).isEqualTo(title);
    }

    @Test
    void recordedIntentIsReplayedAndClearedOnceFastApiRecovers() throws Exception {
        INGEST_FAILS.set(true);
        String title = "복구 검증 업무";
        long taskId = createTaskAsLeader(title);
        await().atMost(Duration.ofSeconds(10))
            .until(() -> countReceived(FASTAPI_INGEST_PATH) >= INGEST_RETRY_ATTEMPTS);
        assertThat(intentContentFor(taskId)).isEqualTo(title);

        INGEST_FAILS.set(false);
        RECEIVED.clear();

        ragIngestService.replayFailures();

        // 복구는 실패 당시 콘텐츠를 DB에서 읽어 다시 보낸다. 메모리에 들고 있던 값이 아니다.
        assertThat(RECEIVED).singleElement().satisfies(request -> {
            assertThat(request.path()).isEqualTo(FASTAPI_INGEST_PATH);
            assertThat(bodyOf(request).get("content")).isEqualTo(title);
        });
        // 처리된 intent는 지워져야 한다. 남으면 매 분 같은 요청을 영원히 반복한다.
        assertThat(intentContentFor(taskId)).isNull();
    }

    private long createTaskAsLeader(String title) throws Exception {
        String response = mockMvc.perform(post("/api/v1/projects/{projectId}/tasks", String.valueOf(projectId))
                .header("Authorization", "Bearer " + leaderToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return taskIdFrom(response);
    }

    @SuppressWarnings("unchecked")
    private long taskIdFrom(String response) {
        // TaskListItem.id는 JS 정밀도 문제를 피하려고 문자열로 내보낸다.
        Map<String, Object> data = (Map<String, Object>) bodyOf(response).get("data");
        return Long.parseLong((String) data.get("id"));
    }

    private org.springframework.test.web.servlet.RequestBuilder ragQuery(
        String token, String question, Long userIdInBody
    ) {
        String body = userIdInBody == null
            ? "{\"project_id\":" + projectId + ",\"question\":\"" + question + "\"}"
            : "{\"project_id\":" + projectId + ",\"question\":\"" + question
                + "\",\"user_id\":" + userIdInBody + "}";
        return post(QUERY_PATH)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    }

    private void awaitIngestWorkerIdle() {
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) ragIngestExecutor;
        await().atMost(Duration.ofSeconds(15)).until(() ->
            executor.getActiveCount() == 0 && executor.getThreadPoolExecutor().getQueue().isEmpty()
        );
    }

    private RecordedRequest onlyRequest() {
        assertThat(RECEIVED).hasSize(1);
        return RECEIVED.get(0);
    }

    private long countReceived(String path) {
        synchronized (RECEIVED) {
            return RECEIVED.stream().filter(request -> request.path().equals(path)).count();
        }
    }

    private Map<String, Object> bodyOf(RecordedRequest request) {
        return bodyOf(request.body());
    }

    private Map<String, Object> bodyOf(String json) {
        try {
            return OBJECT_MAPPER.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private boolean taskExists(long taskId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT count(*) FROM tasks WHERE id = ?", Integer.class, taskId
        );
        return count != null && count > 0;
    }

    /** 아웃박스에 남은 재색인 콘텐츠. 없으면 null. */
    private String intentContentFor(long taskId) {
        List<String> contents = jdbcTemplate.queryForList(
            "SELECT error_message FROM " + OUTBOX_TABLE
                + " WHERE project_id = ? AND source_type = 'ingest:task' AND source_id = ?",
            String.class, projectId, taskId
        );
        return contents.isEmpty() ? null : contents.get(0);
    }

    private long createUser(String email, String name) {
        return userRepository.save(new User(email, name, "local", email)).getId();
    }

    private long insertProject(String title) {
        Long id = jdbcTemplate.queryForObject(
            "INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            Long.class, title, leaderId
        );
        if (id == null) {
            throw new IllegalStateException("프로젝트 생성 실패: " + title);
        }
        return id;
    }

    /** 컨테이너를 클래스 간에 공유하므로 앞선 실행이 남긴 행을 직접 치운다. */
    private void cleanUpPreviousRun() {
        jdbcTemplate.update(
            "DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE title = 'rag-boundary-project')"
        );
        jdbcTemplate.update(
            "DELETE FROM project_members WHERE project_id IN"
                + " (SELECT id FROM projects WHERE title = 'rag-boundary-project')"
        );
        jdbcTemplate.update("DELETE FROM projects WHERE title = 'rag-boundary-project'");
        jdbcTemplate.update(
            "DELETE FROM users WHERE email IN (?, ?)",
            "rag-boundary-leader@workflow.test", "rag-boundary-stranger@workflow.test"
        );
    }
}
