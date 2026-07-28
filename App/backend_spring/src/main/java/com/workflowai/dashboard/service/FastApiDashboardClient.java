package com.workflowai.dashboard.service;

import java.net.http.HttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

@Component
public class FastApiDashboardClient {
    private final RestClient restClient;

    public FastApiDashboardClient(
        @Value("${workflow.ai.base-url}") String baseUrl,
        @Value("${workflow.ai.internal-key}") String internalKey
    ) {
        // JDK HttpClient는 plaintext(http://) 대상에도 기본적으로 HTTP/2(h2c) 업그레이드를 시도하는데,
        // uvicorn(FastAPI)이 이를 지원하지 않아 요청이 깨진다. HTTP/1.1을 명시해 우회한다.
        HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .build();
        this.restClient = RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(new JdkClientHttpRequestFactory(httpClient))
            .defaultHeader("X-Internal-Api-Key", internalKey)
            .build();
    }

    /**
     * ml_delay_risk의 지연 위험도 모델로 프로젝트의 모든 미완료 업무를 다시 예측시키고
     * ml_predictions 테이블에 새 행을 쓰게 한다. 호출부(DashboardService)는 이 호출이 끝난 뒤
     * ml_predictions을 다시 읽어 최신 예측을 조립하므로, 응답 바디는 (snake_case FastAPI 스키마를
     * 굳이 camelCase Java 객체로 옮겨 담을 필요 없이) 상태 코드만 확인하고 버린다.
     */
    public void refreshDelayRisk(Long projectId) {
        String uri = UriComponentsBuilder.fromPath("/ai/predict/delay/tasks/predict")
            .queryParam("project_id", projectId)
            .toUriString();
        restClient.post()
            .uri(uri)
            .retrieve()
            .toBodilessEntity();
    }
}
