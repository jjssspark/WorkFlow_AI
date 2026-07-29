package com.workflowai.dashboard.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.dashboard.service.DashboardService;
import com.workflowai.security.ProjectAccess;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

/**
 * 대시보드 조회 API의 프로젝트 멤버십 검사.
 *
 * <p>SecurityConfig는 anyRequest().authenticated()까지만 걸기 때문에, 로그인만 되어 있으면
 * 경로의 projectId를 남의 프로젝트로 바꾸는 것만으로 그 프로젝트의 업무 목록·담당자·지연
 * 위험도까지 그대로 읽을 수 있었다. 프로젝트별 권한은 오직 메서드 레벨 @PreAuthorize만
 * 막아 주므로, 조회 엔드포인트마다 그것이 실제로 걸려 있는지 여기서 확인한다.
 */
@WebMvcTest(DashboardController.class)
@AutoConfigureMockMvc(addFilters = false)
class DashboardSecurityTest {

    private static final String OTHER_PROJECT = "other-project";

    @Autowired private MockMvc mockMvc;

    @MockBean private DashboardService dashboardService;

    @MockBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @ParameterizedTest
    @ValueSource(strings = {"summary", "tasks", "activities", "progress"})
    void nonMemberCannotReadAnotherProjectDashboard(String endpoint) throws Exception {
        when(projectAccess.isMember(OTHER_PROJECT)).thenReturn(false);

        mockMvc.perform(get("/api/v1/projects/{projectId}/dashboard/" + endpoint, OTHER_PROJECT)
                .with(user("outsider")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void rejectionHappensBeforeAnyProjectDataIsRead() throws Exception {
        // 403을 돌려주면서 이미 서비스가 조회를 마쳤다면, 남의 프로젝트 데이터를 실제로 읽고
        // 응답에서만 감춘 셈이다. 거부는 조회 전에 일어나야 한다.
        when(projectAccess.isMember(OTHER_PROJECT)).thenReturn(false);

        mockMvc.perform(get("/api/v1/projects/{projectId}/dashboard/summary", OTHER_PROJECT)
                .with(user("outsider")))
            .andExpect(status().isForbidden());

        verify(dashboardService, never()).getSummary(any());
    }

    /**
     * 위 테스트들의 대조군. 없으면 이 엔드포인트들이 누구에게나 403을 주도록 바뀌어도(혹은 아예
     * 동작하지 않아도) 통과한다.
     */
    @Test
    void memberOfTheProjectIsAllowedThrough() throws Exception {
        when(projectAccess.isMember("my-project")).thenReturn(true);
        when(dashboardService.getActivities("my-project")).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/projects/{projectId}/dashboard/activities", "my-project")
                .with(user("member")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(dashboardService).getActivities("my-project");
    }

    @SpringBootConfiguration
    @EnableMethodSecurity
    @Import(DashboardController.class)
    static class MethodSecurityTestConfig {

        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
