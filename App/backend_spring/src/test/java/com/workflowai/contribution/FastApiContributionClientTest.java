package com.workflowai.contribution;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class FastApiContributionClientTest {

    private static final String INTERNAL_KEY = "contribution-report-client-test-key";

    @Test
    void generateCarriesTheInternalApiKeyHeader() throws Exception {
        // FastAPI의 verify_internal_api_key가 /ai/report/contribution 라우터 전체에 걸려 있다.
        AtomicReference<String> capturedKey = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/ai/report/contribution", exchange -> {
            capturedKey.set(exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"));
            byte[] body = "[]".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        try {
            FastApiContributionClient client = new FastApiContributionClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY);

            client.generate(new ContributionReportRequest(1L));

            assertThat(capturedKey.get()).isEqualTo(INTERNAL_KEY);
        } finally {
            server.stop(0);
        }
    }
}
