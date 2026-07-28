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
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

// MethodSecurityTestConfig에는 일부러 @SpringBootConfiguration을 붙이지 않는다. 붙이면 같은
// 패키지(com.workflowai.project)의 @SpringBootTest가 설정 클래스 자동 탐지에서 실제 앱의 메인
// 클래스 대신 이 클래스를 더 가까운 후보로 집어, ProjectService조차 없는 빈 컨텍스트가 뜬다.
// TaskControllerSecurityTest가 같은 이유로 이미 @ContextConfiguration을 쓰고 있다.
//
// 권한 거부 응답 대역도 com.workflowai 밖(testsupport)의 것을 쓴다. @RestControllerAdvice는
// @Component라, 이 패키지 안에 두면 @SpringBootTest의 컴포넌트 스캔에 걸려 통합 테스트의 실제
// 컨텍스트에까지 등록되고 SecurityConfig보다 먼저 403을 만든다(IT-002에서 확인된 문제).
@WebMvcTest(ProjectController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = ProjectControllerSecurityTest.MethodSecurityTestConfig.class)
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

    @Test
    void unfinalizeEvaluationReturns403WhenCallerIsNotReviewer() throws Exception {
        when(projectAccess.hasRole(eq(1L), eq("REVIEWER"))).thenReturn(false);

        mockMvc.perform(
                post("/api/v1/projects/1/unfinalize-evaluation")
                    .with(user("member"))
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
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
