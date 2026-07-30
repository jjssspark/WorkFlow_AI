package com.workflowai.project;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

// ProjectControllerSecurityTest와 동일한 이유로 @ContextConfiguration을 명시한다: 같은 패키지에
// @SpringBootConfiguration이 붙은 설정 클래스(MethodSecurityTestConfig)가 있으면 @WebMvcTest의
// 자동 설정 탐지가 이를 잘못 채택할 수 있다.
@WebMvcTest(ProjectController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = ProjectControllerTest.MethodSecurityTestConfig.class)
class ProjectControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProjectService projectService;

    @MockBean
    private ActivityService activityService;

    @MockBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void touchAccessReturnsOkAndRecordsAccessForMember() throws Exception {
        UserPrincipal principal = new UserPrincipal(1L, "member@example.com", "멤버");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(projectAccess.isMember(1L)).thenReturn(true);

        mockMvc.perform(post("/api/v1/projects/1/access"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(projectService).touchAccess(eq(1L), eq(1L));
    }

    @Test
    void touchAccessReturnsForbiddenForNonMember() throws Exception {
        UserPrincipal principal = new UserPrincipal(2L, "stranger@example.com", "비멤버");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(projectAccess.isMember(1L)).thenReturn(false);

        mockMvc.perform(post("/api/v1/projects/1/access"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verify(projectService, never()).touchAccess(eq(1L), eq(2L));
    }

    @EnableMethodSecurity
    @Import(ProjectController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
