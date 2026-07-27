package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.security.JwtService;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * IT-039 회의 분석 완료~RAG 자동 색인~질의 연계 (실물 스택 실측).
 *
 * <p><strong>기본적으로 건너뛴다.</strong> {@code IT039_LIVE_STACK=true}가 있을 때만 돈다.
 * 외부에 실제로 떠 있는 FastAPI(실제 임베딩 모델 로드 완료)와 pgvector를 전제하기 때문이다.
 * CI 스위트({@code ci/verify-context-test-ran.py})에 등록하지 않는 이유도 같다.
 *
 * <p>다른 통합 테스트와 무엇이 다른가. 지금까지는 색인 줄기를 조각내어 검증했다.
 *
 * <ul>
 *   <li>{@code FastApiRagClientWireContractTest} - 스프링이 보내는 JSON 모양
 *   <li>{@code RagFastApiBoundaryIntegrationTest} - 대역 FastAPI에 요청이 도달하는지
 *   <li>{@code test_rag_indexing_integration.py} - 실제 pgvector 위의 색인/검색 (임베딩은 대역)
 * </ul>
 *
 * 각 조각은 이웃을 대역으로 뒀다. 여기서는 <b>대역이 하나도 없다.</b> 실제 bge-m3 임베딩,
 * 실제 pgvector 코사인 검색, 실제 LLM 답변 생성까지 전부 운영과 같은 구성으로 돈다.
 * 조각들이 각자 맞는데 이어 붙이면 틀린 경우를 잡는 것이 이 테스트의 유일한 존재 이유다.
 *
 * <p>실행 방법은 docs/trouble-shooting에 적어둔 절차를 따른다. 요약하면 pgvector 컨테이너와
 * Redis를 고정 포트로 띄우고, 같은 DB를 보도록 uvicorn을 기동한 뒤 아래 환경변수를 준다.
 *
 * <pre>
 *   IT039_LIVE_STACK=true
 *   IT039_DB_URL       기본값 jdbc:postgresql://127.0.0.1:55432/workflow
 *   IT039_FASTAPI_URL  기본값 http://127.0.0.1:58000
 *   IT039_INTERNAL_KEY uvicorn에 준 RAG_INTERNAL_API_KEY와 같은 값
 * </pre>
 */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "IT039_LIVE_STACK", matches = "true")
class MeetingIndexingLiveStackIntegrationTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    @DynamicPropertySource
    static void liveStackProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> env("IT039_DB_URL", "jdbc:postgresql://127.0.0.1:55432/workflow"));
        registry.add("spring.datasource.username", () -> env("IT039_DB_USER", "workflow"));
        registry.add("spring.datasource.password", () -> env("IT039_DB_PASSWORD", "workflow"));
        registry.add("spring.data.redis.host", () -> env("IT039_REDIS_HOST", "127.0.0.1"));
        registry.add("spring.data.redis.port", () -> env("IT039_REDIS_PORT", "56379"));
        // 스키마는 db/init이 컨테이너 기동 시 이미 만들었다. Hibernate나 Flyway가 손대면
        // 검증 대상이 운영 스키마가 아니게 된다.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("workflow.ai.base-url", () -> env("IT039_FASTAPI_URL", "http://127.0.0.1:58000"));
        registry.add("workflow.ai.internal-key", () -> env("IT039_INTERNAL_KEY", "it039-internal-key"));
        registry.add("workflow.jwt.secret", () -> "test-secret-key-for-integration-tests-32bytes-minimum-length");
        // 재시도 백오프를 줄여 색인 실패 시 기다림을 짧게 한다(성공 경로에는 영향 없음).
        registry.add("rag.assignee-sync.retry.delay-ms", () -> "50");
        registry.add("rag.assignee-sync.retry.multiplier", () -> "1");
    }

    @Autowired
    private MeetingAnalysisPersistence persistence;

    @Autowired
    private MeetingRepository meetingRepository;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void savingAMeetingAnalysisIndexesItAndTheRealQueryReturnsItAsASource() throws Exception {
        long memberId = seedUser();
        long projectId = seedProject(memberId);
        long meetingId = seedMeeting(projectId, memberId);

        // 트리거는 "회의 분석 저장"이다. 색인 요청을 따로 보내지 않는다는 것이 IT-039의 핵심이다.
        persistence.saveAnalysisSuccess(meetingId, deploymentDecisionResult(), "FASTAPI");

        // 색인은 커밋 이후 별도 스레드에서 실물 FastAPI로 나간다. 실제 임베딩 계산이 끼어
        // 대역보다 오래 걸리므로 넉넉히 기다린다.
        await().atMost(Duration.ofSeconds(60)).until(() -> indexedChunkCount(projectId, meetingId) > 0);

        String response = mockMvc.perform(post("/api/v1/ai/rag/query")
                .header("Authorization", "Bearer " + jwtService.issueAccessToken(
                    userRepository.findById(memberId).orElseThrow()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"project_id\":" + projectId + ",\"question\":\"결제 모듈 배포는 언제로 정했나요?\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        List<Map<String, Object>> sources = sourcesOf(response);
        assertThat(sources)
            .as("수동 색인 없이 저장만으로 이 회의가 근거에 들어와야 한다")
            .anySatisfy(source -> {
                assertThat(source.get("source_type")).isEqualTo("meeting");
                assertThat(((Number) source.get("source_id")).longValue()).isEqualTo(meetingId);
            });
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sourcesOf(String response) throws Exception {
        Map<String, Object> envelope = OBJECT_MAPPER.readValue(response, new TypeReference<>() {});
        Map<String, Object> data = (Map<String, Object>) envelope.get("data");
        return (List<Map<String, Object>>) data.get("sources");
    }

    private int indexedChunkCount(long projectId, long meetingId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT count(*) FROM document_chunks WHERE project_id = ? AND source_type = 'meeting' AND source_id = ?",
            Integer.class, projectId, meetingId
        );
        return count == null ? 0 : count;
    }

    private long seedUser() {
        String email = "it039-live@workflow.test";
        return userRepository.findByEmail(email)
            .map(User::getId)
            .orElseGet(() -> userRepository.save(new User(email, "실물 검증", "local", email)).getId());
    }

    private long seedProject(long memberId) {
        Long projectId = jdbcTemplate.queryForObject(
            "INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            Long.class, "IT-039 실물 스택 " + System.nanoTime(), memberId
        );
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'LEADER')",
            projectId, memberId
        );
        return projectId;
    }

    private long seedMeeting(long projectId, long uploaderId) {
        return meetingRepository.save(new Meeting(
            projectId, "7월 정기회의", "document", null, "processing",
            LocalDate.now(), "7월 정기회의", "meeting.txt", uploaderId, null
        )).getId();
    }

    private MeetingAnalysisResult deploymentDecisionResult() {
        return new MeetingAnalysisResult(
            "결제 모듈 배포 일정과 검수 담당을 정했다.",
            List.of("결제 모듈 배포를 다음 주 화요일로 확정한다."),
            List.of(),
            List.of("배포 전 결제 연동 검수가 끝나지 않으면 일정이 밀린다."),
            List.of("결제", "배포"),
            new MeetingMeta("7월 정기회의", "2026-07-27", List.of())
        );
    }
}
