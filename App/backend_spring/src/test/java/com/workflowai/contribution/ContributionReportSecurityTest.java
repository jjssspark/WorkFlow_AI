package com.workflowai.contribution;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.rag.RagRateLimiter;
import com.workflowai.security.ProjectAccess;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

@WebMvcTest(ContributionReportController.class)
@AutoConfigureMockMvc(addFilters = false)
class ContributionReportSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private FastApiContributionClient fastApiContributionClient;

    @MockBean
    private RagRateLimiter rateLimiter;

    @MockBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @Test
    void generateReportReturns403WhenProjectAccessRejectsNonReviewer() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("REVIEWER"))).thenReturn(false);

        String body = objectMapper.writeValueAsString(new ContributionReportRequest(1L));

        mockMvc.perform(
                post("/api/v1/ai/contribution/report")
                    .with(user("member"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        // UT-201. 403을 돌려주면서 이미 FastAPI를 호출했다면, 권한 없는 사람의 요청이 LLM 요약을
        // 실제로 태우고 결과만 감춘 셈이다. 거부는 호출 전에 일어나야 한다.
        verify(fastApiContributionClient, never()).generate(any());
    }

    /**
     * UT-208/UT-210. 권한 판정에 쓰는 projectId는 요청 바디에서 온다. 그 값을 그대로 검사에
     * 넘기지 않고 세션이나 다른 출처의 값으로 바꿔치기하면, 프로젝트 1의 심사자가 바디에
     * project_id=2를 실어 보내는 것만으로 남의 프로젝트 집계를 돌릴 수 있다.
     */
    @Test
    void reviewerOfOneProjectCannotRunTheReportForAnother() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("REVIEWER"))).thenReturn(true);
        when(projectAccess.hasRole(eq(2L), eq("REVIEWER"))).thenReturn(false);

        mockMvc.perform(
                post("/api/v1/ai/contribution/report")
                    .with(user("reviewer-of-project-1"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(new ContributionReportRequest(2L)))
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verify(fastApiContributionClient, never()).generate(any());
    }

    /**
     * 위 두 테스트의 대조군이다. 없으면 이 엔드포인트가 누구에게나 항상 403을 주도록 바뀌어도
     * (혹은 아예 동작하지 않아도) 두 테스트는 그대로 통과한다.
     */
    @Test
    void reviewerOfTheRequestedProjectIsAllowedThrough() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("REVIEWER"))).thenReturn(true);
        when(rateLimiter.tryAcquire(1L)).thenReturn(true);
        when(fastApiContributionClient.generate(any())).thenReturn(List.of());

        mockMvc.perform(
                post("/api/v1/ai/contribution/report")
                    .with(user("reviewer-of-project-1"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(new ContributionReportRequest(1L)))
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(fastApiContributionClient).generate(any());
    }

    @SpringBootConfiguration
    @EnableMethodSecurity
    @Import(ContributionReportController.class)
    static class MethodSecurityTestConfig {

        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
