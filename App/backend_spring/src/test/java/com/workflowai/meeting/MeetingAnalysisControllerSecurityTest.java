package com.workflowai.meeting;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

// MethodSecurityTestConfig는 TaskControllerSecurityTest와 같은 이유로 @SpringBootConfiguration을 쓰지 않고
// @ContextConfiguration으로 명시한다. AccessDeniedResponseAdvice도 다른 패키지의 동명 테스트 전용 advice와
// 빈 이름이 충돌하지 않도록 이 클래스만의 이름(MeetingAnalysisAccessDeniedResponseAdvice)을 쓴다.
@WebMvcTest(MeetingAnalysisController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = MeetingAnalysisControllerSecurityTest.MethodSecurityTestConfig.class)
class MeetingAnalysisControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MeetingAnalysisService meetingAnalysisService;

    @MockitoBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @Test
    void registerTasksReturns403WhenNotLeader() throws Exception {
        when(projectAccess.hasRole(eq("demo-project"), eq("LEADER"))).thenReturn(false);

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/5/tasks/register")
                .with(user("member"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"todos\":[]}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void analyzeReturns403WhenReviewer() throws Exception {
        // REVIEWER는 프로젝트 멤버(isMember=true)이지만 LEADER도 MEMBER도 아니므로 hasRole은 모두 false.
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);

        mockMvc.perform(multipart("/api/v1/projects/demo-project/meetings/analyze")
                .with(user("reviewer")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void deleteMeetingReturns403WhenReviewer() throws Exception {
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/5")
                .with(user("reviewer")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void deleteMeetingReturns403WhenMember() throws Exception {
        // 회의록 삭제는 팀장 전용이라 팀원(MEMBER)도 403이어야 한다.
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);
        when(projectAccess.hasRole(eq("demo-project"), eq("MEMBER"))).thenReturn(true);

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/5")
                .with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void reanalyzeReturns403WhenReviewer() throws Exception {
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/6/reanalyze")
                .with(user("reviewer")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void deleteMeetingAnalysisReturns403WhenReviewer() throws Exception {
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/5/analysis")
                .with(user("reviewer")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void deleteMeetingAnalysisReturns403WhenMember() throws Exception {
        // 분석 결과 삭제도 팀장 전용이라 팀원(MEMBER)도 403이어야 한다.
        when(projectAccess.isMember(eq("demo-project"))).thenReturn(true);
        when(projectAccess.hasRole(eq("demo-project"), eq("MEMBER"))).thenReturn(true);

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/5/analysis")
                .with(user("member")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Configuration
    @EnableMethodSecurity
    @Import(MeetingAnalysisController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }
    }
}
