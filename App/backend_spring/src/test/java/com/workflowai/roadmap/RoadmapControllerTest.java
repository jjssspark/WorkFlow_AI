package com.workflowai.roadmap;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

/**
 * UT-147/UT-156. RoadmapServiceTest는 서비스를 직접 호출하므로 컨트롤러에 붙은 두 가지를 건드리지
 * 않는다 - {@code @PreAuthorize}로 거는 역할 검사와, RoadmapException을 공통 오류 형식으로 바꾸는
 * {@link RoadmapExceptionHandler}다. 둘 다 서비스 밖에 있어서 서비스 테스트로는 사라져도 알 수 없다.
 *
 * <p>MethodSecurityTestConfig에 {@code @SpringBootConfiguration}을 붙이지 않는 이유는
 * ProjectControllerSecurityTest에 적어 둔 것과 같다 - 붙이면 같은 패키지의 {@code @SpringBootTest}가
 * 앱의 메인 클래스 대신 이 클래스를 설정 클래스로 집어 빈 컨텍스트가 뜬다. 권한 거부 응답 대역도
 * {@code com.workflowai} 밖(testsupport)의 것을 써서 컴포넌트 스캔에 걸리지 않게 한다.
 */
@WebMvcTest(RoadmapController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = RoadmapControllerTest.MethodSecurityTestConfig.class)
class RoadmapControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private RoadmapService roadmapService;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private DemoDataService demoDataService;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /**
     * 멤버십은 항상 참으로 두고 역할만 바꾼다. 여기서 {@code existsByProjectIdAndUserId}까지 참으로
     * 두지 않으면, 팀원이 403을 받은 이유가 "역할이 팀장이 아니어서"인지 "애초에 멤버가 아니어서"인지
     * 구분되지 않는다 - 실제로 이 스텁이 없을 때 LEADER 검사를 isMember로 바꾸는 변이를 걸었더니
     * 아래 팀원 테스트는 그대로 통과했다.
     */
    private void authenticateAs(long userId, ProjectRole role) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
        ));
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, userId)).thenReturn(true);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, userId))
            .thenReturn(Optional.of(new ProjectMember(1L, userId, role)));
    }

    @Test
    @DisplayName("UT-147 팀원은 마일스톤을 만들 수 없고 서비스까지 요청이 가지 않는다")
    void memberCannotCreateMilestone() throws Exception {
        authenticateAs(5L, ProjectRole.MEMBER);

        mockMvc.perform(post("/api/v1/projects/1/roadmap/milestones")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"임의 마일스톤\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verify(roadmapService, never()).createMilestone(anyString(), any());
    }

    /**
     * 위 테스트의 대조군이다. 이게 없으면 {@code @PreAuthorize}가 역할과 무관하게 항상 막도록
     * 바뀌어도(혹은 엔드포인트가 사라져도) 위 테스트는 그대로 통과한다.
     */
    @Test
    @DisplayName("팀장은 같은 요청으로 마일스톤을 만들 수 있다")
    void leaderCanCreateMilestone() throws Exception {
        authenticateAs(6L, ProjectRole.LEADER);
        when(roadmapService.createMilestone(anyString(), any()))
            .thenReturn(new RoadmapMilestoneDto("5", "1차 릴리스", null, null, 0, 0, 0, List.of()));

        mockMvc.perform(post("/api/v1/projects/1/roadmap/milestones")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"1차 릴리스\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.id").value("5"));
    }

    @Test
    @DisplayName("UT-156 RoadmapException은 지정한 상태코드와 코드·메시지를 그대로 실은 오류 응답이 된다")
    void roadmapExceptionBecomesTheCommonErrorEnvelope() throws Exception {
        authenticateAs(6L, ProjectRole.LEADER);
        when(roadmapService.moveTask(anyString(), anyLong(), any()))
            .thenThrow(new RoadmapException(HttpStatus.NOT_FOUND, "MILESTONE_NOT_FOUND", "마일스톤을 찾을 수 없습니다."));

        mockMvc.perform(patch("/api/v1/projects/1/roadmap/tasks/10/milestone")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"milestoneId\":999999}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("MILESTONE_NOT_FOUND"))
            .andExpect(jsonPath("$.error.message").value("마일스톤을 찾을 수 없습니다."));
    }

    /**
     * 상태코드가 예외에 담긴 값을 따라가는지 본다. 위 테스트만 있으면 핸들러가 무조건 404를
     * 돌려주도록 바뀌어도 드러나지 않는다 - 400이어야 할 입력 오류가 404로 나가면 프론트가
     * "없는 데이터"로 오해한다.
     */
    @Test
    @DisplayName("400 계열 로드맵 오류는 400으로 나간다")
    void roadmapExceptionKeepsItsOwnStatusCode() throws Exception {
        authenticateAs(6L, ProjectRole.LEADER);
        when(roadmapService.createMilestone(anyString(), any()))
            .thenThrow(new RoadmapException(HttpStatus.BAD_REQUEST, "INVALID_DATE", "dueDate는 YYYY-MM-DD 형식이어야 합니다."));

        mockMvc.perform(post("/api/v1/projects/1/roadmap/milestones")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"형식 오류\",\"dueDate\":\"2026/08/31\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_DATE"));
    }

    @Configuration
    @EnableMethodSecurity
    @Import({RoadmapController.class, RoadmapExceptionHandler.class})
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }

        @Bean("projectAccess")
        ProjectAccess projectAccess(ProjectMemberRepository projectMemberRepository, DemoDataService demoDataService) {
            return new ProjectAccess(projectMemberRepository, demoDataService);
        }
    }
}
