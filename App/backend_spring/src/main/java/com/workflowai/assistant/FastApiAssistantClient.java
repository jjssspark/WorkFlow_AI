package com.workflowai.assistant;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class FastApiAssistantClient {
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);

    private final RestClient restClient;

    public FastApiAssistantClient(
        @Value("${workflow.ai.base-url}") String baseUrl,
        @Value("${workflow.ai.internal-key}") String internalKey,
        // 명령 경로는 계획 LLM 호출이 끼어 질의응답보다 길어진다. 로컬 ollama 기준 웜 33초,
        // 모델이 내려간 콜드 상태에서 44.6초가 걸렸다(2026-07-28 실측). 여기서 끊으면 FastAPI가
        // 이미 만들어 놓은 답을 버리고 사용자에게 "일시적으로 처리할 수 없습니다"가 나간다.
        // 회의록 분석(FastApiMeetingClient)과는 걸리는 시간이 달라 프로퍼티를 분리한다.
        @Value("${workflow.ai.assistant-read-timeout-seconds:120}") long readTimeoutSeconds
    ) {
        HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(CONNECT_TIMEOUT)
            .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(readTimeoutSeconds));
        this.restClient = RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(requestFactory)
            .defaultHeader("X-Internal-Api-Key", internalKey)
            .build();
    }

    public AssistantResponse command(FastApiAssistantRequest request) {
        return restClient.post()
            .uri("/ai/assistant/command")
            .contentType(MediaType.APPLICATION_JSON)
            .body(request)
            .retrieve()
            .body(AssistantResponse.class);
    }

    public AssistantResponse resume(FastApiAssistantResumeRequest request) {
        return restClient.post()
            .uri("/ai/assistant/resume")
            .contentType(MediaType.APPLICATION_JSON)
            .body(request)
            .retrieve()
            .body(AssistantResponse.class);
    }
}
