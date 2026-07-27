package com.workflowai.contribution;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.rag.RagRateLimiter;
import com.workflowai.security.ProjectAccess;
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
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
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
