package com.workflowai.contribution;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class FastApiContributionScoreClient {
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    private final RestClient restClient;

    public FastApiContributionScoreClient(
        @Value("${workflow.ai.base-url}") String baseUrl,
        @Value("${workflow.ai.internal-key}") String internalKey
    ) {
        HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(CONNECT_TIMEOUT)
            .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(READ_TIMEOUT);
        this.restClient = RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(requestFactory)
            .defaultHeader("X-Internal-Api-Key", internalKey)
            .build();
    }

    public ContributionScoreResponseDto fetch(Long projectId) {
        ContributionScoreEnvelope envelope = restClient.post()
            .uri("/ai/score/contribution?project_id={id}", projectId)
            .retrieve()
            .body(ContributionScoreEnvelope.class);
        return envelope.data();
    }
}
