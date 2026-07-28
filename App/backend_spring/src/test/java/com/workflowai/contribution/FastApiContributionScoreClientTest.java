package com.workflowai.contribution;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class FastApiContributionScoreClientTest {

    private static final String INTERNAL_KEY = "contribution-score-client-test-key";

    @Test
    void fetchCarriesTheInternalApiKeyHeader() throws Exception {
        // FastAPI의 verify_internal_api_key가 /ai/score/contribution 라우터 전체에 걸려 있다.
        AtomicReference<String> capturedKey = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/ai/score/contribution", exchange -> {
            capturedKey.set(exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"));
            byte[] body = ("{\"success\":true,\"data\":{\"schema_version\":\"1.0\",\"project_id\":1,"
                + "\"members\":[],\"note\":null,\"team_mean_completion\":null}}")
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        try {
            FastApiContributionScoreClient client = new FastApiContributionScoreClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY);

            client.fetch(1L);

            assertThat(capturedKey.get()).isEqualTo(INTERNAL_KEY);
        } finally {
            server.stop(0);
        }
    }
}
