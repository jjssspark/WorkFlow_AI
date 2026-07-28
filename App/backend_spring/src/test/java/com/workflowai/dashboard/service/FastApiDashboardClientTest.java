package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class FastApiDashboardClientTest {

    private static final String INTERNAL_KEY = "dashboard-client-test-key";

    @Test
    void refreshDelayRiskCarriesTheInternalApiKeyHeader() throws Exception {
        // FastAPI의 verify_internal_api_key가 /ai/predict/delay 라우터 전체에 걸려 있다.
        AtomicReference<String> capturedKey = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/ai/predict/delay/tasks/predict", exchange -> {
            capturedKey.set(exchange.getRequestHeaders().getFirst("X-Internal-Api-Key"));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();

        try {
            FastApiDashboardClient client = new FastApiDashboardClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), INTERNAL_KEY);

            client.refreshDelayRisk(1L);

            assertThat(capturedKey.get()).isEqualTo(INTERNAL_KEY);
        } finally {
            server.stop(0);
        }
    }
}
