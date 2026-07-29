package com.workflowai.project;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.ProjectAccess;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

// MethodSecurityTestConfig는 일부러 @SpringBootConfiguration을 쓰지 않는다. 같은 패키지(com.workflowai.project)의
// InvitationControllerTest처럼 설정 클래스를 명시하지 않고 자동 탐지에 의존하는 테스트가 있는데,
// @SpringBootConfiguration을 붙이면 그 자동 탐지가 이 클래스를 후보로 집어 다른 테스트가 깨진다.
// 대신 @ContextConfiguration으로 명시적으로 지정해 자동 탐지 자체를 우회한다 (TaskControllerSecurityTest와 동일 패턴).
@WebMvcTest(InvitationController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = InvitationControllerSecurityTest.MethodSecurityTestConfig.class)
class InvitationControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InvitationService invitationService;

    @MockitoBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @Test
    void createLinkReturns403WhenCallerIsNotLeader() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("LEADER"))).thenReturn(false);

        mockMvc.perform(post("/api/v1/projects/1/invitations/link").with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Configuration
    @EnableMethodSecurity
    @Import(InvitationController.class)
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
