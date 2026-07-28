package com.workflowai.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

/**
 * IT-032 어시스턴트 확인~실행 연계 - 스프링과 FastAPI가 주고받는 것의 계약.
 *
 * <p>{@link FastApiRagClientWireContractTest}와 같은 이유로 필요하다. 어시스턴트 경로의
 * 테스트는 전부 {@link FastApiAssistantClient}를 목으로 두므로, 이 클래스가 만드는 HTTP
 * 요청과 그것이 응답을 어떻게 읽는지는 어느 테스트도 본 적이 없다.
 *
 * <p>RAG 색인과 다른 점이 하나 있고, 그게 더 고약하다. 색인은 나가는 방향만 있었는데
 * 여기는 <b>돌아오는 방향</b>이 있다.
 *
 * <pre>
 *   FastApiAssistantRequest        나가기만 함 - 이름이 틀리면 FastAPI 422
 *   FastApiAssistantResumeRequest  나가기만 함 - 이름이 틀리면 FastAPI 422
 *   AssistantResponse              들어오기만 함 - 이름이 틀리면 <b>조용히 null</b>
 * </pre>
 *
 * Spring Boot의 Jackson 기본값은 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}다. FastAPI가
 * 응답 필드명을 바꾸거나 우리가 record 필드명을 바꾸면 예외 없이 {@code card}가 null이 된다.
 * 그러면 확인 카드가 화면에서 사라지는데 서버 로그에는 아무것도 남지 않는다. 사용자에게는
 * "어시스턴트가 갑자기 아무것도 못 하게 됨"으로 보인다.
 *
 * <p>기대 필드명의 출처는 llm_rag_assistant/app/schema/assistant_schema.py다. 스키마 파일을
 * 여기서 파싱하는 대신 상수로 복제했는데, 그것만으로는 한쪽 방향의 드리프트를 못 잡는다.
 * 파이썬 스키마만 고치면 이 테스트는 자기 상수와 비교하므로 그대로 통과한다.
 *
 * <p>그래서 <b>같은 필드 집합을 파이썬 쪽에도 못 박아 두었다.</b> 한쪽만 고치면 반대편이
 * 깨져 나머지 한쪽을 상기시킨다.
 *
 * <pre>
 *   backend_fastapi/tests/llm_rag_assistant/test_assistant_router_graph_integration.py
 *     test_wire_field_names_match_what_spring_sends_and_reads
 * </pre>
 */
class FastApiAssistantClientWireContractTest {

    /** FastAPI AssistantCommandRequest(assistant_schema.py)가 선언한 필드 전부. */
    private static final Set<String> COMMAND_FIELDS =
        Set.of("project_id", "question", "user_id", "user_role", "history");

    /** FastAPI AssistantResumeRequest가 선언한 필드 전부. */
    private static final Set<String> RESUME_FIELDS = Set.of("thread_id", "step_id", "ok", "error");

    private static final String INTERNAL_KEY = "assistant-wire-contract-key";

    /** FastAPI가 실제로 돌려주는 확인 응답. ActionCard의 필드명까지 그대로 옮겼다. */
    private static final String CONFIRM_RESPONSE_BODY = """
        {"type":"confirm",
         "message":"이 작업을 실행할까요?",
         "sources":[],
         "thread_id":"thread-abc",
         "card":{"step_id":"0-a1b2c3d4","tool":"set_due_date","task_id":42,
                 "title":"마감일 변경","summary":"'결제 모듈 구현' 마감을 2026-07-29로",
                 "args":{"date":"2026-07-29"}}}
        """;

    /** 계약 검증용 호출이 타임아웃에 걸리지 않도록 넉넉히 준다. 타임아웃 자체는 전용 테스트에서 본다. */
    private static final long GENEROUS_READ_TIMEOUT_SECONDS = 30;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<CapturedRequest> captured = Collections.synchronizedList(new ArrayList<>());

    private HttpServer server;
    private FastApiAssistantClient client;
    /** 0이 아니면 가짜 FastAPI가 응답 전에 이만큼 잔다. 읽기 타임아웃 검증용. */
    private volatile long responseDelayMillis;

    private record CapturedRequest(String method, String path, String internalKey, String body) {}

    @BeforeEach
    void startFakeFastApi() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ai/assistant", this::handle);
        server.start();
        client = newClient(GENEROUS_READ_TIMEOUT_SECONDS);
    }

    private FastApiAssistantClient newClient(long readTimeoutSeconds) {
        return new FastApiAssistantClient(
            "http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY, readTimeoutSeconds);
    }

    @AfterEach
    void stopFakeFastApi() {
        server.stop(0);
    }

    @Test
    void commandSendsTheFieldNamesFastApiDeclaresAndNothingElse() throws Exception {
        client.command(new FastApiAssistantRequest(
            7L, "결제 모듈 구현 업무 마감을 내일로 바꿔줘", 12L, "LEADER",
            List.of(new AssistantHistoryMessage("user", "지난 질문"))
        ));

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/ai/assistant/command");

        Map<String, Object> body = readBody(request);
        assertThat(body.keySet()).isEqualTo(COMMAND_FIELDS);
        assertThat(body.get("project_id")).isEqualTo(7);
        assertThat(body.get("question")).isEqualTo("결제 모듈 구현 업무 마감을 내일로 바꿔줘");
        assertThat(body.get("user_id")).isEqualTo(12);
        // user_role은 FastAPI에서 Literal["LEADER","MEMBER","REVIEWER"]다. 이 값이 유실되면
        // 기본값 MEMBER로 떨어져 팀장에게도 확인 카드가 나오지 않는다.
        assertThat(body.get("user_role")).isEqualTo("LEADER");
    }

    @Test
    void historyIsSentAsTheRoleContentPairsFastApiExpects() throws Exception {
        client.command(new FastApiAssistantRequest(
            7L, "그 업무 마감 바꿔줘", 12L, "LEADER",
            List.of(new AssistantHistoryMessage("user", "결제 모듈 얘기였어"),
                new AssistantHistoryMessage("assistant", "네, 결제 모듈 구현 업무입니다"))
        ));

        Map<String, Object> body = readBody(onlyRequest());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> history = (List<Map<String, Object>>) body.get("history");
        assertThat(history).hasSize(2);
        // FastAPI RagHistoryMessage는 role이 Literal["user","assistant"]다. 키 이름이 다르면 422.
        assertThat(history.get(0).keySet()).isEqualTo(Set.of("role", "content"));
        assertThat(history.get(0).get("role")).isEqualTo("user");
        assertThat(history.get(1).get("content")).isEqualTo("네, 결제 모듈 구현 업무입니다");
    }

    @Test
    void resumeSendsTheFieldNamesFastApiDeclaresAndNothingElse() throws Exception {
        client.resume(new FastApiAssistantResumeRequest("thread-abc", "0-a1b2c3d4", true, null));

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/ai/assistant/resume");

        Map<String, Object> body = readBody(request);
        assertThat(body.keySet()).isEqualTo(RESUME_FIELDS);
        assertThat(body.get("thread_id")).isEqualTo("thread-abc");
        // step_id는 FastAPI가 "지금 대기 중인 그 단계의 결과인가"를 판정하는 유일한 근거다.
        // 이 값이 누락되면 resume_command가 fail-closed로 단계 불일치 처리한다.
        assertThat(body.get("step_id")).isEqualTo("0-a1b2c3d4");
        assertThat(body.get("ok")).isEqualTo(true);
    }

    @Test
    void resumeCarriesTheFailureReasonWhenTheFrontendCouldNotExecute() throws Exception {
        client.resume(new FastApiAssistantResumeRequest("thread-abc", "0-a1b2c3d4", false, "403 FORBIDDEN"));

        Map<String, Object> body = readBody(onlyRequest());
        assertThat(body.keySet()).isEqualTo(RESUME_FIELDS);
        assertThat(body.get("ok")).isEqualTo(false);
        // 이 문자열이 그대로 사용자 메시지("작업을 완료하지 못했습니다: ...")에 들어간다.
        assertThat(body.get("error")).isEqualTo("403 FORBIDDEN");
    }

    @Test
    void confirmResponseIsReadIntoTheCardTheFrontendNeeds() {
        // 돌아오는 방향의 계약이다. 이름이 어긋나면 예외 없이 null이 되고, 확인 카드가
        // 화면에서 사라진 채 로그에는 아무 흔적도 남지 않는다.
        AssistantResponse response = client.command(
            new FastApiAssistantRequest(7L, "마감 바꿔줘", 12L, "LEADER", List.of())
        );

        assertThat(response.type()).isEqualTo("confirm");
        assertThat(response.thread_id()).isEqualTo("thread-abc");
        assertThat(response.card())
            .as("card가 null이면 프론트가 실행 버튼을 띄우지 못한다")
            .isNotNull();
        assertThat(response.card())
            .containsEntry("step_id", "0-a1b2c3d4")
            .containsEntry("tool", "set_due_date")
            .containsEntry("task_id", 42)
            .containsEntry("args", Map.of("date", "2026-07-29"));
    }

    @Test
    void bothAssistantCallsCarryTheInternalApiKeyHeader() {
        // FastAPI의 verify_internal_api_key가 어시스턴트 라우터 전체에 걸려 있다.
        client.command(new FastApiAssistantRequest(7L, "마감 바꿔줘", 12L, "LEADER", List.of()));
        client.resume(new FastApiAssistantResumeRequest("thread-abc", "0-a1b2c3d4", true, null));

        assertThat(captured).hasSize(2);
        assertThat(captured).allSatisfy(request -> assertThat(request.internalKey()).isEqualTo(INTERNAL_KEY));
    }

    @Test
    void readTimeoutComesFromConfigurationSoASlowAnswerCanBeWaitedFor() {
        // 어시스턴트 한 번 호출은 로컬 ollama 기준 웜 33초, 콜드 44.6초가 걸린다(2026-07-28 실측).
        // 이 값이 코드에 박혀 있으면 느린 프로바이더를 만났을 때 재빌드 없이는 못 늘린다.
        // FastAPI는 그 사이에도 답을 다 만들어 200을 돌려주므로, 여기서 끊는다는 건
        // 이미 만들어진 답을 버리고 사용자에게 "일시적으로 처리할 수 없습니다"를 보여준다는 뜻이다.
        responseDelayMillis = 3_000;
        FastApiAssistantClient impatient = newClient(1);

        assertThatThrownBy(() -> impatient.command(
            new FastApiAssistantRequest(7L, "마감 바꿔줘", 12L, "LEADER", List.of())
        )).isInstanceOf(ResourceAccessException.class);

        // 같은 서버·같은 지연이어도 설정을 늘리면 답을 받아낸다.
        assertThat(newClient(GENEROUS_READ_TIMEOUT_SECONDS).command(
            new FastApiAssistantRequest(7L, "마감 바꿔줘", 12L, "LEADER", List.of())
        ).thread_id()).isEqualTo("thread-abc");
    }

    private CapturedRequest onlyRequest() {
        assertThat(captured).hasSize(1);
        return captured.get(0);
    }

    private Map<String, Object> readBody(CapturedRequest request) throws IOException {
        return objectMapper.readValue(request.body(), new TypeReference<>() {});
    }

    private void handle(HttpExchange exchange) throws IOException {
        if (responseDelayMillis > 0) {
            try {
                Thread.sleep(responseDelayMillis);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }
        captured.add(new CapturedRequest(
            exchange.getRequestMethod(),
            exchange.getRequestURI().getPath(),
            exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"),
            new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)
        ));

        byte[] payload = CONFIRM_RESPONSE_BODY.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }
}
