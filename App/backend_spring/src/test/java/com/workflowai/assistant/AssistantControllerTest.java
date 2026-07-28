package com.workflowai.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.rag.RagRateLimiter;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import java.util.Optional;
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
class AssistantControllerTest {

    @Mock
    private FastApiAssistantClient fastApiAssistantClient;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    @Mock
    private AssistantThreadOwnership threadOwnership;

    private final RagRateLimiter rateLimiter = new RagRateLimiter(10, 60);

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

    private MockMvc mockMvc() {
        return MockMvcBuilders.standaloneSetup(
            new AssistantController(fastApiAssistantClient, rateLimiter, projectMemberRepository, threadOwnership)
        ).build();
    }

    private void stubRole(long userId, ProjectRole role) {
        // ProjectMember의 무인자 생성자는 protected(JPA 전용)라 다른 패키지에서 쓸 수 없다.
        ProjectMember member = new ProjectMember(1L, userId, role);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, userId)).thenReturn(Optional.of(member));
    }

    @Test
    void commandFillsUserIdAndRoleFromSessionNotRequestBody() throws Exception {
        // 요청 바디로 LEADER를 참칭해도 세션 역할(MEMBER)로 덮어써야 한다.
        authenticateAs(5L);
        stubRole(5L, ProjectRole.MEMBER);
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenReturn(new AssistantResponse("answer", "답변", List.of(), null, null));

        String body = """
            {"project_id":1,"question":"질문","user_id":999,"user_role":"LEADER","history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());

        ArgumentCaptor<FastApiAssistantRequest> captor =
            ArgumentCaptor.forClass(FastApiAssistantRequest.class);
        verify(fastApiAssistantClient).command(captor.capture());
        assertThat(captor.getValue().user_id()).isEqualTo(5L);
        assertThat(captor.getValue().user_role()).isEqualTo("MEMBER");
    }

    @Test
    void leaderRoleIsForwardedAsLeader() throws Exception {
        authenticateAs(7L);
        stubRole(7L, ProjectRole.LEADER);
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenReturn(new AssistantResponse("answer", "답변", List.of(), null, null));

        String body = """
            {"project_id":1,"question":"질문","history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk());

        ArgumentCaptor<FastApiAssistantRequest> captor =
            ArgumentCaptor.forClass(FastApiAssistantRequest.class);
        verify(fastApiAssistantClient).command(captor.capture());
        assertThat(captor.getValue().user_role()).isEqualTo("LEADER");
    }

    @Test
    void missingMembershipIsRejected() throws Exception {
        authenticateAs(9L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.empty());

        String body = """
            {"project_id":1,"question":"질문","history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("NOT_PROJECT_MEMBER"));

        // 거부만으로는 부족하다. 403을 돌려주면서 이미 FastAPI를 호출했다면 비멤버의 질문이
        // 그래프를 태우고 LLM 비용까지 쓴 뒤 결과만 감춘 셈이 된다.
        verify(fastApiAssistantClient, org.mockito.Mockito.never()).command(any());
    }

    @Test
    void rejectsHistoryWithNullElementInsteadOf500() throws Exception {
        authenticateAs(5L);
        String body = """
            {"project_id":1,"question":"질문","history":[null]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_HISTORY"));
    }

    @Test
    void rejectsBlankQuestionInsteadOfCallingLlm() throws Exception {
        // 빈/공백 질문은 클라이언트 잘못이다. FastAPI로 넘기면 무의미한 LLM 호출을 태우거나
        // (null이면) FastAPI 422 → RestClientException → 503으로 위장된다. 400으로 먼저 끊는다.
        authenticateAs(5L);
        String body = """
            {"project_id":1,"question":"   ","history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_QUESTION"));
        verify(fastApiAssistantClient, org.mockito.Mockito.never()).command(any());
    }

    @Test
    void rejectsNullQuestionAsBadRequestNot503() throws Exception {
        authenticateAs(5L);
        String body = """
            {"project_id":1,"question":null,"history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_QUESTION"));
        verify(fastApiAssistantClient, org.mockito.Mockito.never()).command(any());
    }

    @Test
    void invalidInputDoesNotConsumeRateBudget() throws Exception {
        // 입력 검증이 rate limit보다 먼저여야 한다. 예산 1짜리 한도에서 잘못된 요청을 보내도
        // 토큰이 소모되지 않아, 뒤이은 정상 요청이 429가 아니라 통과해야 한다.
        authenticateAs(5L);
        stubRole(5L, ProjectRole.MEMBER);
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenReturn(new AssistantResponse("answer", "답변", List.of(), null, null));
        RagRateLimiter oneShot = new RagRateLimiter(1, 60);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(
            new AssistantController(fastApiAssistantClient, oneShot, projectMemberRepository, threadOwnership)
        ).build();

        // 잘못된 질문 3번 — 예산을 소모했다면 이후 정상 요청이 429가 된다.
        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/v1/ai/assistant/command")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"project_id\":1,\"question\":\"  \",\"history\":[]}"))
                .andExpect(status().isBadRequest());
        }

        mockMvc.perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"project_id\":1,\"question\":\"정상 질문\",\"history\":[]}"))
            .andExpect(status().isOk());
    }

    @Test
    void resumeIsRejectedWhenThreadBelongsToAnotherUser() throws Exception {
        authenticateAs(5L);
        when(threadOwnership.isOwnedBy("thread-1", 5L)).thenReturn(false);

        String body = """
            {"project_id":1,"thread_id":"thread-1","step_id":"0-abc","ok":true}""";

        mockMvc().perform(post("/api/v1/ai/assistant/resume")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("THREAD_NOT_OWNED"));
    }

    @Test
    void resumeForwardsResultWhenThreadIsOwned() throws Exception {
        authenticateAs(5L);
        when(threadOwnership.isOwnedBy("thread-1", 5L)).thenReturn(true);
        when(fastApiAssistantClient.resume(any(FastApiAssistantResumeRequest.class)))
            .thenReturn(new AssistantResponse("done", "1개 작업을 완료했습니다.", List.of(), null, null));

        String body = """
            {"project_id":1,"thread_id":"thread-1","step_id":"0-abc","ok":true}""";

        mockMvc().perform(post("/api/v1/ai/assistant/resume")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.type").value("done"));
    }

    @Test
    void returns503WhenFastApiCallFails() throws Exception {
        authenticateAs(5L);
        stubRole(5L, ProjectRole.MEMBER);
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenThrow(new org.springframework.web.client.ResourceAccessException(
                "I/O error on POST for \"http://ai-backend:8000/ai/assistant/command\": Connection refused"));

        String body = """
            {"project_id":1,"question":"질문","history":[]}""";

        mockMvc().perform(post("/api/v1/ai/assistant/command")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("ASSISTANT_UNAVAILABLE"))
            // 예외 메시지를 그대로 실어 보내면 내부 호스트명·포트가 클라이언트에 노출된다.
            .andExpect(jsonPath("$.error.message").value("일시적으로 처리할 수 없습니다."))
            .andExpect(result -> assertThat(result.getResponse().getContentAsString())
                .doesNotContain("ai-backend").doesNotContain("Connection refused"));
    }
}
