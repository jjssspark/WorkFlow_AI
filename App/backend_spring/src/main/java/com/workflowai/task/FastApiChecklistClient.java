package com.workflowai.task;

import com.workflowai.task.ChecklistAiDtos.ChecklistGenerateAiRequest;
import com.workflowai.task.ChecklistAiDtos.ChecklistGenerateAiResponse;
import java.net.http.HttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class FastApiChecklistClient {
    private final RestClient restClient;

    public FastApiChecklistClient(
        @Value("${workflow.ai.base-url}") String baseUrl,
        @Value("${workflow.ai.internal-key}") String internalKey
    ) {
        // uvicorn h2c 미지원 회피: HTTP/1.1 강제 (FastApiMeetingClient와 동일 이유)
        HttpClient httpClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        this.restClient = RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(new JdkClientHttpRequestFactory(httpClient))
            .defaultHeader("X-Internal-Api-Key", internalKey)
            .build();
    }

    public ChecklistGenerateAiResponse generate(ChecklistGenerateAiRequest request) {
        return restClient.post()
            .uri("/ai/checklist/generate")
            .contentType(MediaType.APPLICATION_JSON)
            .body(request)
            .retrieve()
            .body(ChecklistGenerateAiResponse.class);
    }
}
