package com.workflowai.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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
import com.workflowai.admin.dto.ReviewerApplicationSummary;
import com.workflowai.common.PageResponse;
import com.workflowai.security.AdminAccess;
import com.workflowai.user.ReviewerStatus;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import testsupport.AccessDeniedEnvelopeAdvice;

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

    @Test
    void listClampsNegativePageToZero() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(true);
        when(adminReviewerService.listApplications(eq(ReviewerStatus.PENDING), any()))
            .thenReturn(new PageResponse<ReviewerApplicationSummary>(List.of(), 0, 20, 0, 0));

        mockMvc.perform(get("/api/v1/admin/reviewers?page=-5").with(user("admin")))
            .andExpect(status().isOk());

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(adminReviewerService).listApplications(eq(ReviewerStatus.PENDING), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageNumber()).isEqualTo(0);
    }

    @Test
    void listClampsOversizedSizeToMax() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(true);
        when(adminReviewerService.listApplications(eq(ReviewerStatus.PENDING), any()))
            .thenReturn(new PageResponse<ReviewerApplicationSummary>(List.of(), 0, 100, 0, 0));

        mockMvc.perform(get("/api/v1/admin/reviewers?size=9999").with(user("admin")))
            .andExpect(status().isOk());

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(adminReviewerService).listApplications(eq(ReviewerStatus.PENDING), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(100);
    }

    @Test
    void listClampsZeroSizeToOne() throws Exception {
        when(adminAccess.isAdmin()).thenReturn(true);
        when(adminReviewerService.listApplications(eq(ReviewerStatus.PENDING), any()))
            .thenReturn(new PageResponse<ReviewerApplicationSummary>(List.of(), 0, 1, 0, 0));

        mockMvc.perform(get("/api/v1/admin/reviewers?size=0").with(user("admin")))
            .andExpect(status().isOk());

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(adminReviewerService).listApplications(eq(ReviewerStatus.PENDING), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(1);
    }

    @SpringBootConfiguration
    @EnableMethodSecurity
    @Import(AdminReviewerController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }

    // 이 어드바이스는 테스트 전용이다 — 실제 403 응답 형식은 SecurityConfig.handleForbidden()이 만든다.
    // 이 테스트는 @PreAuthorize가 실제로 차단하는지만 검증한다.
    @RestControllerAdvice
    static class AccessDeniedResponseAdvice {
        @ExceptionHandler(AccessDeniedException.class)
        org.springframework.http.ResponseEntity<com.workflowai.common.ApiResponse<Void>> handleAccessDenied() {
            return org.springframework.http.ResponseEntity.status(403)
                .body(com.workflowai.common.ApiResponse.fail("FORBIDDEN", "권한이 없습니다."));
        }
    }
}
