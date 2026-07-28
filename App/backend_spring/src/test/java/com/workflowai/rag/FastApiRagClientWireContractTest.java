package com.workflowai.rag;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * IT-039 자동 색인 연계 - 스프링이 FastAPI에게 실제로 무엇을 보내는지 검증한다.
 *
 * <p>배경. 색인 줄기(회의분석/업무 저장 → RagIngestService → FastAPI)에는 테스트가 이미 많지만
 * 전부 목 위에 있다. 트리거 쪽 테스트는 {@code verify(ragIngestService).ingestBestEffort(...)}로
 * 목 호출 인자만 보고, {@link RagIngestServiceRetryTest} 계열은 {@link FastApiRagClient}를 목으로
 * 둔다. 그래서 <b>이 클래스가 만드는 HTTP 요청 자체는 어느 테스트도 본 적이 없다.</b>
 *
 * <p>왜 위험한가. {@link RagIngestRequest}는 자바 record인데 필드명이 {@code project_id},
 * {@code source_type}, {@code assignee_id}처럼 snake_case다. FastAPI의 Pydantic 모델
 * (llm_rag_assistant/app/schema/chat_schema.py)과 글자 단위로 맞춰둔 것이고, 오직 그 이유로만
 * 자바 관례를 어기고 있다. 누군가 이를 camelCase로 "정리"하면
 *
 * <pre>
 *   스프링 테스트 - 전부 통과 (FastApiRagClient가 목이라 JSON을 만들지도 않는다)
 *   운영         - FastAPI가 422 → ingestBestEffort의 @Recover가 예외를 삼킴 → 경고 로그 한 줄
 *   사용자       - 모든 질문에 "관련 정보가 없습니다"
 * </pre>
 *
 * RAG 색인이 통째로 멈추는데 배포는 성공으로 표시된다. 색인은 best-effort라 실패해도 아무
 * 화면이 깨지지 않기 때문에 발견이 가장 늦는 종류의 사고다.
 *
 * <p>그래서 여기서는 JDK 내장 HttpServer를 가짜 FastAPI로 띄우고, 스프링이 실제로 만들어 보낸
 * 메서드·경로·헤더·JSON 키를 그대로 포착해 확인한다. 스프링 컨텍스트를 쓰지 않고 클라이언트를
 * 직접 생성하는 이유는, 검증 대상이 빈 배선이 아니라 와이어 포맷이기 때문이다.
 *
 * <p>이 테스트가 덮지 못하는 것: 양쪽이 <b>같은 방향으로 함께</b> 바뀌는 경우. 기대 키 집합을
 * 상수로 못 박고 출처 파일을 주석에 남긴 것은 그때 이 파일도 같이 고치게 하기 위해서다.
 */
class FastApiRagClientWireContractTest {

    /** FastAPI RagIngestRequest(chat_schema.py)가 선언한 필드 전부. 하나라도 다르면 운영에서 422다. */
    private static final Set<String> INGEST_FIELDS =
        Set.of("project_id", "source_type", "source_id", "content", "assignee_id");

    /** FastAPI RagAssigneeSyncRequest(chat_schema.py)가 선언한 필드 전부. */
    private static final Set<String> ASSIGNEE_SYNC_FIELDS =
        Set.of("project_id", "source_type", "source_id", "assignee_id");

    private static final String INTERNAL_KEY = "wire-contract-test-key";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<CapturedRequest> captured = Collections.synchronizedList(new ArrayList<>());

    private HttpServer server;
    private FastApiRagClient client;

    /** 가짜 FastAPI가 받아낸 요청 그대로. 스프링이 무엇을 보냈는지의 유일한 증거다. */
    private record CapturedRequest(String method, String path, String internalKey, String body) {}

    @BeforeEach
    void startFakeFastApi() throws IOException {
        // 포트 0은 커널이 빈 포트를 고르게 한다. 고정 포트를 쓰면 병렬 실행이나 로컬에서
        // 이미 뜬 FastAPI(8000)와 충돌해 간헐적으로 실패한다.
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ai/rag", this::handle);
        server.start();

        client = new FastApiRagClient("http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY);
    }

    @AfterEach
    void stopFakeFastApi() {
        server.stop(0);
    }

    @Test
    void ingestSendsTheFieldNamesFastApiDeclaresAndNothingElse() throws Exception {
        client.ingest(new RagIngestRequest(7L, "task", 42L, "결제 모듈 구현", 12L));

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/ai/rag/ingest");

        Map<String, Object> body = readBody(request);
        // isEqualTo가 아니라 containsExactlyInAnyOrderElementsOf를 쓰면 "빠진 키"만 잡고
        // "늘어난 키"는 놓친다. FastAPI 모델은 정의되지 않은 필드를 무시하므로 늘어난 쪽은
        // 조용히 버려지고, 그 필드를 믿고 만든 기능이 동작하지 않는다.
        assertThat(body.keySet()).isEqualTo(INGEST_FIELDS);
        assertThat(body.get("project_id")).isEqualTo(7);
        assertThat(body.get("source_type")).isEqualTo("task");
        assertThat(body.get("source_id")).isEqualTo(42);
        assertThat(body.get("content")).isEqualTo("결제 모듈 구현");
        assertThat(body.get("assignee_id")).isEqualTo(12);
    }

    @Test
    void ingestKeepsSendingAssigneeIdEvenWhenItIsNull() throws Exception {
        // 담당자 없는 회의록 색인 경로다. 이 키가 통째로 빠져도 FastAPI 기본값(None) 덕에
        // 지금은 통과하지만, 키 집합이 요청마다 달라지면 계약이 흐려지므로 함께 고정한다.
        client.ingest(new RagIngestRequest(7L, "meeting", 21L, "회의 요약", null));

        Map<String, Object> body = readBody(onlyRequest());
        assertThat(body.keySet()).isEqualTo(INGEST_FIELDS);
        assertThat(body.get("assignee_id")).isNull();
    }

    @Test
    void ingestResponseIsReadFromTheFieldNamesFastApiReturns() {
        // 응답 방향도 계약이다. chunk_count를 chunkCount로 읽으면 0이 들어오고, 색인이
        // 실패한 것처럼 보이거나 성공 판정 로직이 뒤집힌다.
        RagIngestResponse response = client.ingest(new RagIngestRequest(7L, "task", 42L, "본문", null));

        assertThat(response.chunk_ids()).containsExactly(101L, 102L);
        assertThat(response.chunk_count()).isEqualTo(2);
    }

    @Test
    void assigneeSyncSendsTheFieldNamesFastApiDeclaresAndNothingElse() throws Exception {
        client.syncAssignee(new RagAssigneeSyncRequest(7L, "task", 42L, 12L));

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/ai/rag/assignee-sync");

        Map<String, Object> body = readBody(request);
        assertThat(body.keySet()).isEqualTo(ASSIGNEE_SYNC_FIELDS);
        assertThat(body.get("source_type")).isEqualTo("task");
        assertThat(body.get("assignee_id")).isEqualTo(12);
    }

    @Test
    void deleteSourceHitsThePathFastApiRoutesWithTheSegmentsInOrder() {
        client.deleteSource(7L, "task", 42L);

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("DELETE");
        // 세그먼트 순서가 바뀌면 FastAPI가 404를 주는데, best-effort라 그 404도 삼켜진다.
        assertThat(request.path()).isEqualTo("/ai/rag/projects/7/sources/task/42");
        assertThat(request.body()).isEmpty();
    }

    @Test
    void deleteProjectSourcesHitsThePathFastApiRoutes() {
        client.deleteProjectSources(7L);

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("DELETE");
        assertThat(request.path()).isEqualTo("/ai/rag/projects/7/sources");
    }

    @Test
    void everyRagCallCarriesTheInternalApiKeyHeader() {
        // FastAPI의 verify_internal_api_key가 라우터 전체에 걸려 있다. 헤더가 빠지면 401이
        // 나고, 색인 경로에서는 그 401마저 조용히 삼켜진다. 색인·동기화·삭제를 한 번에 본다.
        client.ingest(new RagIngestRequest(7L, "task", 42L, "본문", null));
        client.syncAssignee(new RagAssigneeSyncRequest(7L, "task", 42L, 12L));
        client.deleteSource(7L, "task", 42L);
        client.deleteProjectSources(7L);

        assertThat(captured).hasSize(4);
        assertThat(captured).allSatisfy(request -> assertThat(request.internalKey()).isEqualTo(INTERNAL_KEY));
    }

    private CapturedRequest onlyRequest() {
        assertThat(captured).hasSize(1);
        return captured.get(0);
    }

    private Map<String, Object> readBody(CapturedRequest request) throws IOException {
        return objectMapper.readValue(request.body(), new com.fasterxml.jackson.core.type.TypeReference<>() {});
    }

    private void handle(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        captured.add(new CapturedRequest(
            exchange.getRequestMethod(),
            exchange.getRequestURI().getPath(),
            exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"),
            body
        ));

        if ("/ai/rag/ingest".equals(exchange.getRequestURI().getPath())) {
            byte[] payload = objectMapper.writeValueAsBytes(
                new LinkedHashMap<>(Map.of("chunk_ids", List.of(101, 102), "chunk_count", 2))
            );
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, payload.length);
            exchange.getResponseBody().write(payload);
        } else {
            // 나머지 엔드포인트는 FastAPI와 동일하게 204 No Content다.
            exchange.sendResponseHeaders(204, -1);
        }
        exchange.close();
    }
}
