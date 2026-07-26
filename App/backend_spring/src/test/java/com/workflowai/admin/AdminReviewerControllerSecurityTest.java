package com.workflowai.admin;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.admin.dto.RejectReviewerRequest;
import com.workflowai.security.AdminAccess;
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

@WebMvcTest(AdminReviewerController.class)
@AutoConfigureMockMvc(addFilters = false)
class AdminReviewerControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AdminReviewerService adminReviewerService;

    @MockBean(name = "adminAccess")
    private AdminAccess adminAccess;

    @Test
    void listReturns403WhenCallerIsNotAdmin() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(false);

        mockMvc.perform(get("/api/v1/admin/reviewers").with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void approveReturns403WhenCallerIsNotAdmin() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(false);

        mockMvc.perform(post("/api/v1/admin/reviewers/1/approve").with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void rejectReturns403WhenCallerIsNotAdmin() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(false);
        String body = objectMapper.writeValueAsString(new RejectReviewerRequest("사유"));

        mockMvc.perform(
                post("/api/v1/admin/reviewers/1/reject")
                    .with(user("member"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void approveReturns200WhenCallerIsAdmin() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(true);

        mockMvc.perform(post("/api/v1/admin/reviewers/1/approve").with(user("admin")))
            .andExpect(status().isOk());

        verify(adminReviewerService).approve(eq(1L));
    }

    @SpringBootConfiguration
    @EnableMethodSecurity
    @Import(AdminReviewerController.class)
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
