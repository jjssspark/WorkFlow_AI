package com.workflowai.project;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.security.ProjectAccess;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@WebMvcTest(ProjectController.class)
@AutoConfigureMockMvc(addFilters = false)
class ProjectControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectService projectService;

    @MockBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @Test
    void updateReturns403WhenCallerIsNotLeader() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("LEADER"))).thenReturn(false);

        String body = objectMapper.writeValueAsString(
            new UpdateProjectRequest("새 이름", null, null, null, null, null, null, null, null, null)
        );

        mockMvc.perform(
                patch("/api/v1/projects/1")
                    .with(user("member"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void finalizeEvaluationReturns403WhenCallerIsNotReviewer() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("REVIEWER"))).thenReturn(false);

        mockMvc.perform(
                post("/api/v1/projects/1/finalize-evaluation")
                    .with(user("member"))
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @SpringBootConfiguration
    @EnableMethodSecurity
    @Import(ProjectController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedResponseAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedResponseAdvice();
        }
    }

    @RestControllerAdvice
    static class AccessDeniedResponseAdvice {
        @ExceptionHandler(AccessDeniedException.class)
        org.springframework.http.ResponseEntity<com.workflowai.common.ApiResponse<Void>> handleAccessDenied() {
            return org.springframework.http.ResponseEntity.status(403)
                .body(com.workflowai.common.ApiResponse.fail("FORBIDDEN", "권한이 없습니다."));
        }
    }
}
