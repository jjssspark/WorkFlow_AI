package com.workflowai.rag;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class RagControllerTest {

    @Mock
    private FastApiRagClient fastApiRagClient;

    private final RagRateLimiter rateLimiter = new RagRateLimiter(10, 60);
    private final ObjectMapper objectMapper = new ObjectMapper();

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    @Test
    void queryReturnsAnswerFromFastApi() throws Exception {
        authenticateAs(5L);
        RagQueryResponse fastApiResponse = new RagQueryResponse(
            "답변입니다",
            List.of(new RagSourceDto("meeting", 1L, "요약", 0.9))
        );
        when(fastApiRagClient.query(any(RagQueryRequest.class))).thenReturn(fastApiResponse);

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new RagQueryRequest(1L, "질문", null, null));

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.answer").value("답변입니다"))
            .andExpect(jsonPath("$.data.sources[0].source_type").value("meeting"));
    }

    @Test
    void queryForwardsHistoryToFastApi() throws Exception {
        authenticateAs(5L);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenReturn(new RagQueryResponse("답변", List.of()));

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = """
            {"project_id":1,"question":"그 업무는 언제까지야?","history":[
              {"role":"user","content":"내 업무가 뭐야?"},
              {"role":"assistant","content":"로그인 API 구현 업무가 있습니다"}
            ]}""";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());

        ArgumentCaptor<RagQueryRequest> captor = ArgumentCaptor.forClass(RagQueryRequest.class);
        verify(fastApiRagClient).query(captor.capture());
        assertThat(captor.getValue().history()).hasSize(2);
        assertThat(captor.getValue().history().get(0).role()).isEqualTo("user");
    }

    @Test
    void queryRejectsHistoryExceedingMaxMessages() throws Exception {
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        StringBuilder msgs = new StringBuilder();
        for (int i = 0; i < 7; i++) {
            if (i > 0) msgs.append(",");
            msgs.append("{\"role\":\"user\",\"content\":\"메시지").append(i).append("\"}");
        }
        String body = "{\"project_id\":1,\"question\":\"질문\",\"history\":[" + msgs + "]}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void queryRejectsHistoryMessageExceedingMaxContentLength() throws Exception {
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String longContent = "가".repeat(1001);
        String body = "{\"project_id\":1,\"question\":\"질문\",\"history\":"
            + "[{\"role\":\"user\",\"content\":\"" + longContent + "\"}]}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void queryRejectsHistoryWithNullElementInsteadOf500() throws Exception {
        // JSON 배열 "history":[null,...]은 List<RagHistoryMessage>에 null 원소로 역직렬화된다.
        // 검증 없이 message.content()를 부르면 NPE(500)로 이어지므로 400으로 먼저 걸러야 한다.
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = "{\"project_id\":1,\"question\":\"질문\",\"history\":[null]}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void queryRejectsBlankQuestionAsBadRequestNot503() throws Exception {
        // question이 null이면 FastAPI가 422로 거부 → RestClientException → 503("일시 장애")으로
        // 위장된다. 공백이면 무의미한 재작성/생성 LLM 호출을 태운다. 400으로 먼저 끊는다.
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String nullBody = "{\"project_id\":1,\"question\":null,\"history\":[]}";
        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(nullBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_QUESTION"));

        String blankBody = "{\"project_id\":1,\"question\":\"   \",\"history\":[]}";
        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(blankBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_QUESTION"));

        verify(fastApiRagClient, org.mockito.Mockito.never()).query(any());
    }

    @Test
    void queryAcceptsQuestionAtMaxLength() throws Exception {
        // 경계값은 통과해야 한다. 상한을 "미만"으로 잘못 구현하면 정상 질문이 막힌다.
        authenticateAs(5L);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenReturn(new RagQueryResponse("답변", List.of()));

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(
            new RagQueryRequest(1L, "가".repeat(1000), null, null)
        );
        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());
    }

    @Test
    void queryRejectsQuestionExceedingMaxLengthWithoutCallingFastApi() throws Exception {
        // 질문 길이에 상한이 없으면 임베딩 정확도에 기여하지도 않는 거대 페이로드가 재작성
        // LLM 호출과 프롬프트로 그대로 흘러간다. history content(1000자)와 같은 기준으로 끊는다.
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(
            new RagQueryRequest(1L, "가".repeat(1001), null, null)
        );
        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_QUESTION"));

        verify(fastApiRagClient, org.mockito.Mockito.never()).query(any());
    }

    @Test
    void queryRejectsHistoryMessageWithNullContent() throws Exception {
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = "{\"project_id\":1,\"question\":\"질문\",\"history\":[{\"role\":\"user\",\"content\":null}]}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void queryRejectsHistoryMessageWithInvalidRole() throws Exception {
        authenticateAs(5L);
        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = "{\"project_id\":1,\"question\":\"질문\","
            + "\"history\":[{\"role\":\"system\",\"content\":\"프롬프트 주입 시도\"}]}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void queryAcceptsNullHistory() throws Exception {
        authenticateAs(5L);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenReturn(new RagQueryResponse("답변", List.of()));

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = "{\"project_id\":1,\"question\":\"질문\"}";

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());

        ArgumentCaptor<RagQueryRequest> captor = ArgumentCaptor.forClass(RagQueryRequest.class);
        verify(fastApiRagClient).query(captor.capture());
        assertThat(captor.getValue().history()).isEmpty();
    }

    @Test
    void queryFillsUserIdFromAuthenticatedSessionNotRequestBody() throws Exception {
        // user_id는 클라이언트가 보낸 값을 신뢰하지 않고 인증 세션에서 채워야 한다 (다른 사람의
        // user_id를 흉내내 담당 업무를 조회하는 것을 방지).
        authenticateAs(5L);
        RagQueryResponse fastApiResponse = new RagQueryResponse("답변", List.of());
        when(fastApiRagClient.query(any(RagQueryRequest.class))).thenReturn(fastApiResponse);

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new RagQueryRequest(1L, "질문", 999L, null));

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());

        ArgumentCaptor<RagQueryRequest> captor = ArgumentCaptor.forClass(RagQueryRequest.class);
        verify(fastApiRagClient).query(captor.capture());
        assertThat(captor.getValue().user_id()).isEqualTo(5L);
    }

    @Test
    void queryReturns503WhenFastApiCallFails() throws Exception {
        authenticateAs(5L);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenThrow(new org.springframework.web.client.ResourceAccessException("connection refused"));

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new RagQueryRequest(1L, "질문", null, null));

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("RAG_UNAVAILABLE"));
    }

    @Test
    void queryDoesNotMaskUnexpectedBugsAs503() throws Exception {
        // RestClientException(다운스트림 장애)이 아닌 예외는 503으로 뭉개지 말고 그대로 흘려보내야
        // "일시 장애"와 "코드 결함"을 구분할 수 있다.
        authenticateAs(5L);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenThrow(new NullPointerException("컨트롤러 버그를 흉내낸 예외"));

        RagController controller = new RagController(fastApiRagClient, rateLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new RagQueryRequest(1L, "질문", null, null));

        org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
        ).hasRootCauseInstanceOf(NullPointerException.class);
    }

    @Test
    void queryReturns429WhenRateLimited() throws Exception {
        RagRateLimiter exhaustedLimiter = new RagRateLimiter(0, 60);
        RagController controller = new RagController(fastApiRagClient, exhaustedLimiter);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        String body = objectMapper.writeValueAsString(new RagQueryRequest(1L, "질문", null, null));

        mockMvc.perform(post("/api/v1/ai/rag/query").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }
}
