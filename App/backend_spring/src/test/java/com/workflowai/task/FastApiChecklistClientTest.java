package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class FastApiChecklistClientTest {

    private static final String INTERNAL_KEY = "checklist-client-test-key";

    @Test
    void constructsWithBaseUrlWithoutError() {
        assertThatCode(() -> new FastApiChecklistClient("http://localhost:8000", INTERNAL_KEY))
            .doesNotThrowAnyException();
    }

    @Test
    void requestRecordExposesSnakeCaseFields() {
        var req = new ChecklistAiDtos.ChecklistGenerateAiRequest(
            "로그인 API", "설명", "backend", "HIGH", "2026-08-01", List.of("API 설계"));
        assertThat(req.existing_items()).containsExactly("API 설계");
        assertThat(req.due_date()).isEqualTo("2026-08-01");
    }

    @Test
    void generateCarriesTheInternalApiKeyHeader() throws Exception {
        // FastAPI의 verify_internal_api_key가 /ai/checklist 라우터 전체에 걸려 있다.
        AtomicReference<String> capturedKey = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/ai/checklist/generate", exchange -> {
            capturedKey.set(exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"));
            byte[] body = "{\"items\":[],\"engine\":\"rule\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        try {
            FastApiChecklistClient client = new FastApiChecklistClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY);

            client.generate(new ChecklistAiDtos.ChecklistGenerateAiRequest(
                "로그인 API", "설명", "backend", "HIGH", "2026-08-01", List.of()));

            assertThat(capturedKey.get()).isEqualTo(INTERNAL_KEY);
        } finally {
            server.stop(0);
        }
    }
}
