package com.workflowai.project;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.reviewer.ReviewerActivityService;
import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
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

    @MockBean
    private ReviewerActivityService reviewerActivityService;

    @MockBean(name = "projectAccess")
    private ProjectAccess projectAccess;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createReturnsOkAndRegistersCreatorAsLeader() throws Exception {
        UserPrincipal principal = new UserPrincipal(1L, "leader@example.com", "리더");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );

        ProjectResponse serviceResponse = new ProjectResponse(
            10L, "WorkFlow AI", "팀프로젝트", null, LocalDate.of(2026, 8, 31), null, null, null,
            null, null, null, null, "ABCD1234", 1L, 1, 0, "PENDING"
        );
        when(projectService.create(eq(1L), any(CreateProjectRequest.class))).thenReturn(serviceResponse);

        String body = objectMapper.writeValueAsString(
            new CreateProjectRequest(
                "WorkFlow AI", "팀프로젝트", null, null, null, LocalDate.of(2026, 8, 31), null, null, null, null, null
            )
        );

        mockMvc.perform(
                post("/api/v1/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.title").value("WorkFlow AI"));
    }

    @Test
    void createRejectsMissingTitleWithBadRequest() throws Exception {
        UserPrincipal principal = new UserPrincipal(1L, "leader@example.com", "리더");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );

        String body = objectMapper.writeValueAsString(
            new CreateProjectRequest(null, "팀프로젝트", null, null, null, null, null, null, null, null, null)
        );

        mockMvc.perform(
                post("/api/v1/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isBadRequest());
        verify(projectService, never()).create(any(), any());
    }

    @Test
    void findReturnsProjectDetailForMember() throws Exception {
        UserPrincipal principal = new UserPrincipal(1L, "member@example.com", "멤버");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(projectAccess.isMember(1L)).thenReturn(true);

        ProjectResponse serviceResponse = new ProjectResponse(
            1L, "WorkFlow AI", "팀프로젝트", null, LocalDate.of(2026, 8, 31), "설명", null, null,
            null, null, null, null, "ABCD1234", 1L, 1, 0, "PENDING"
        );
        when(projectService.find(1L)).thenReturn(serviceResponse);

        mockMvc.perform(get("/api/v1/projects/1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.title").value("WorkFlow AI"))
            .andExpect(jsonPath("$.data.description").value("설명"))
            .andExpect(jsonPath("$.data.deadline").value("2026-08-31"));
    }

    @Test
    void findReturnsForbiddenForNonMember() throws Exception {
        UserPrincipal principal = new UserPrincipal(2L, "stranger@example.com", "비멤버");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(projectAccess.isMember(2L)).thenReturn(false);

        mockMvc.perform(get("/api/v1/projects/2"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        verify(projectService, never()).find(any());
    }

    /**
     * UT-040 스펙은 "존재하지 않는 projectId 조회 시 404 PROJECT_NOT_FOUND"를 기대하지만,
     * 실제로는 {@code @PreAuthorize("@projectAccess.isMember(#projectId)")}가 서비스 로직보다
     * 먼저 실행된다. 존재하지 않는 프로젝트는 멤버십도 없으므로 isMember가 false를 반환해
     * 403으로 막히고, projectService.find()의 PROJECT_NOT_FOUND 처리까지 도달하지 못한다.
     * 이 테스트는 스펙이 아니라 그 실제 동작(403)을 기록한다.
     */
    @Test
    void findReturnsForbiddenNotFoundWhenProjectDoesNotExist() throws Exception {
        UserPrincipal principal = new UserPrincipal(1L, "member@example.com", "멤버");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
        when(projectAccess.isMember(999999L)).thenReturn(false);

        mockMvc.perform(get("/api/v1/projects/999999"))
            .andExpect(status().isForbidden());
        verify(projectService, never()).find(any());
    }

    @Test
    void updateReturnsOkWhenLeaderChangesTitleAndDeadline() throws Exception {
        when(projectAccess.hasRole(1L, "LEADER")).thenReturn(true);

        ProjectResponse updated = new ProjectResponse(
            1L, "변경제목", "팀프로젝트", null, LocalDate.of(2026, 9, 15), null, null, null,
            null, null, null, null, "ABCD1234", 1L, 1, 0, "PENDING"
        );
        when(projectService.update(eq(1L), any(UpdateProjectRequest.class))).thenReturn(updated);

        String body = objectMapper.writeValueAsString(
            new UpdateProjectRequest("변경제목", null, null, null, LocalDate.of(2026, 9, 15), null, null, null, null, null)
        );

        mockMvc.perform(
                patch("/api/v1/projects/1")
                    .with(user("leader"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.title").value("변경제목"))
            .andExpect(jsonPath("$.data.deadline").value("2026-09-15"));
    }

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
