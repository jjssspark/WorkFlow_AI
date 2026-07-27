package com.workflowai.rag;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

/**
 * RagController.query()의 @PreAuthorize("@projectAccess.isMember(#request.project_id())")가
 * 실제로 다른 프로젝트 조회를 차단하는지 검증한다 (IDOR 회귀 테스트). RagControllerTest는
 * standaloneSetup을 써서 메서드 보안 자체를 거치지 않으므로, 이 검증은 그 테스트로는 커버되지 않는다.
 */
@WebMvcTest(RagController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = RagControllerSecurityTest.MethodSecurityTestConfig.class)
class RagControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FastApiRagClient fastApiRagClient;

    @MockitoBean
    private RagRateLimiter rateLimiter;

    @MockitoBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void queryReturns403WhenRequesterIsNotProjectMember() throws Exception {
        authenticateAs(5L);
        when(projectAccess.isMember(eq(999L))).thenReturn(false);

        mockMvc.perform(post("/api/v1/ai/rag/query")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"project_id\":999,\"question\":\"이 프로젝트 회의록 요약해줘\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void queryReturns200WhenRequesterIsProjectMember() throws Exception {
        authenticateAs(5L);
        when(projectAccess.isMember(eq(1L))).thenReturn(true);
        when(rateLimiter.tryAcquire(eq(1L))).thenReturn(true);
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenReturn(new RagQueryResponse("답변", List.of()));

        mockMvc.perform(post("/api/v1/ai/rag/query")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"project_id\":1,\"question\":\"질문\"}"))
            .andExpect(status().isOk());
    }

    @Configuration
    @EnableMethodSecurity
    @Import(RagController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
