package com.workflowai.contribution;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.rag.RagRateLimiter;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class ContributionScoreControllerTest {

    @Mock
    private FastApiContributionScoreClient fastApiContributionScoreClient;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void getScoreReturnsDataFromFastApi() throws Exception {
        ContributionScoreResponseDto fastApiResponse = new ContributionScoreResponseDto(
            "1.0",
            1L,
            List.of(new ContributionMemberScoreDto("3", 100.0, 80.0, 80.0, 86.7, "정상", 1.0, 1.0, 1.0, 0)),
            null,
            0.65
        );
        when(fastApiContributionScoreClient.fetch(1L)).thenReturn(fastApiResponse);

        ContributionScoreController controller = new ContributionScoreController(
            fastApiContributionScoreClient,
            new RagRateLimiter(10, 60)
        );
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new ContributionScoreRequest(1L));

        mockMvc.perform(post("/api/v1/ai/contribution/score").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.members[0].assignee_id").value("3"))
            .andExpect(jsonPath("$.data.members[0].contribution_score").value(86.7))
            .andExpect(jsonPath("$.data.members[0].anomaly_type").value("정상"))
            .andExpect(jsonPath("$.data.members[0].task_count_active_rel").value(1.0))
            .andExpect(jsonPath("$.data.members[0].difficulty_avg_rel").value(1.0))
            .andExpect(jsonPath("$.data.members[0].overdue_count").value(0))
            // FastAPI가 내려준 team_mean_completion이 그대로 노출돼야 함 —
            // 편중도 근거 패널이 "팀 평균보다 높음/낮음" 문구의 실측 근거로 사용한다.
            .andExpect(jsonPath("$.data.team_mean_completion").value(0.65));
    }

    @Test
    void getScoreReturns503WhenFastApiFails() throws Exception {
        when(fastApiContributionScoreClient.fetch(any())).thenThrow(new RuntimeException("connection refused"));

        ContributionScoreController controller = new ContributionScoreController(
            fastApiContributionScoreClient,
            new RagRateLimiter(10, 60)
        );
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new ContributionScoreRequest(1L));

        mockMvc.perform(post("/api/v1/ai/contribution/score").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("CONTRIBUTION_SCORE_UNAVAILABLE"));
    }

    @Test
    void getScoreReturns429WhenRateLimited() throws Exception {
        ContributionScoreController controller = new ContributionScoreController(
            fastApiContributionScoreClient,
            new RagRateLimiter(0, 60)
        );
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new ContributionScoreRequest(1L));

        mockMvc.perform(post("/api/v1/ai/contribution/score").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }
}
