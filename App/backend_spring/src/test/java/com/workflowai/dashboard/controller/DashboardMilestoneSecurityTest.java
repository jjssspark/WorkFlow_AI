package com.workflowai.dashboard.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.dashboard.service.DashboardService;
import com.workflowai.security.ProjectAccess;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

/**
 * 마일스톤 생성/수정/삭제는 팀장 전용 UI(DashProgressPage.tsx의 isLeader 게이팅)만 있고
 * 팀원에게는 아예 버튼이 노출되지 않는다 - 그 전제가 서버에서도 실제로 강제되는지 검증한다.
 * TaskControllerSecurityTest와 동일한 패턴(@WebMvcTest + @EnableMethodSecurity)을 쓴다.
 */
@WebMvcTest(DashboardController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = DashboardMilestoneSecurityTest.MethodSecurityTestConfig.class)
class DashboardMilestoneSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DashboardService dashboardService;

    @MockitoBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @Test
    void createMilestoneReturns403WhenNotLeader() throws Exception {
        when(projectAccess.hasRole(eq("demo-project"), eq("LEADER"))).thenReturn(false);

        mockMvc.perform(post("/api/v1/projects/demo-project/dashboard/milestones")
                .with(user("member"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"MVP 발표\",\"dueDate\":\"2026-08-15\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void updateMilestoneReturns403WhenNotLeader() throws Exception {
        when(projectAccess.hasRole(eq("demo-project"), eq("LEADER"))).thenReturn(false);

        mockMvc.perform(patch("/api/v1/projects/demo-project/dashboard/milestones/1")
                .with(user("member"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"새 이름\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void deleteMilestoneReturns403WhenNotLeader() throws Exception {
        when(projectAccess.hasRole(eq("demo-project"), eq("LEADER"))).thenReturn(false);

        mockMvc.perform(delete("/api/v1/projects/demo-project/dashboard/milestones/1")
                .with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Configuration
    @EnableMethodSecurity
    @Import(DashboardController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
