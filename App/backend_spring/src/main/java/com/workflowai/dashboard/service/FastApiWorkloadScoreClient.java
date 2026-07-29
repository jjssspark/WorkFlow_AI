package com.workflowai.dashboard.service;

import com.workflowai.dashboard.DTO.WorkloadScoreEnvelope;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class FastApiWorkloadScoreClient {
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    private final RestClient restClient;

    public FastApiWorkloadScoreClient(
        @Value("${workflow.ai.base-url}") String baseUrl,
        @Value("${workflow.ai.internal-key}") String internalKey
    ) {
        // JDK HttpClient는 plaintext(http://) 대상에도 기본적으로 HTTP/2(h2c) 업그레이드를 시도하는데,
        // uvicorn(FastAPI)이 이를 지원하지 않아 요청이 깨진다. HTTP/1.1을 명시해 우회한다.
        HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(CONNECT_TIMEOUT)
            .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(READ_TIMEOUT);
        this.restClient = RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(requestFactory)
            // FastAPI core/security.py의 verify_internal_api_key가 이 헤더로 Spring 외의
            // 직접 호출(docker-compose가 8000 포트를 노출함)을 차단한다.
            .defaultHeader("X-Internal-Api-Key", internalKey)
            .build();
    }

    /** ml_workload_score(FastAPI)의 /ai/score/workload를 호출해 팀원별 업무 편중(과부하/저활동) 점수를 가져온다.
     * ml_predictions처럼 DB에 저장해두고 읽는 방식이 아니라 호출 시점에 즉시 계산되는 라이브 조회라,
     * 실패 시 되돌아갈 캐시가 없다(호출부가 실패를 그대로 처리해야 함). */
    public WorkloadScoreResponseDto fetch(Long projectId) {
        WorkloadScoreEnvelope envelope = restClient.post()
            .uri("/ai/score/workload?project_id={id}", projectId)
            .retrieve()
            .body(WorkloadScoreEnvelope.class);
        return envelope.data();
    }
}
