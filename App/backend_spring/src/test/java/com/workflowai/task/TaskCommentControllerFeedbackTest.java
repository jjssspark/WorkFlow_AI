package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TaskCommentController.class)
@AutoConfigureMockMvc(addFilters = false)
class TaskCommentControllerFeedbackTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TaskCommentRepository taskCommentRepository;

    @MockitoBean
    private TaskRepository taskRepository;

    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private DemoDataService demoDataService;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private NotificationService notificationService;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    // 실제 요청에서는 JwtAuthenticationFilter가 이 인증 정보를 채운다. 로그인 사용자의 DB id만이
    // 작성자/팀장 판정 근거이므로, 요청 바디의 authorId를 조작해 팀장 명의로 글을 남길 수 없다.
    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    private Task existingTask() {
        return new Task(
            1L, "로그인 API 구현", "backend", "done", 1L,
            LocalDate.of(2026, 7, 1), "high", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void leaderCanPostFeedback() throws Exception {
        authenticateAs(100L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 100L))
            .thenReturn(Optional.of(new ProjectMember(1L, 100L, ProjectRole.LEADER)));
        when(taskCommentRepository.save(any(TaskComment.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(userRepository.findById(100L))
            .thenReturn(Optional.of(new User("leader@workflow.ai", "김민준", "demo", "1")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"화면 반응형 처리 다시 확인해주세요","type":"FEEDBACK"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.type").value("FEEDBACK"));

        verify(notificationService).notifyAfterCommit(eq(1L), eq(1L), eq("TASK_COMMENT"), any(), any(), eq("task"), any());
    }

    @Test
    void nonLeaderCannotPostFeedback() throws Exception {
        authenticateAs(200L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 200L))
            .thenReturn(Optional.of(new ProjectMember(1L, 200L, ProjectRole.MEMBER)));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"제가 피드백 남길게요","type":"FEEDBACK"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_LEADER"));
    }

    @Test
    void nonMemberCannotPostFeedback() throws Exception {
        authenticateAs(300L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 300L))
            .thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"피드백입니다","type":"FEEDBACK"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_LEADER"));
    }

    @Test
    void defaultsToCommentTypeWhenOmitted() throws Exception {
        authenticateAs(200L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(existingTask()));
        when(taskCommentRepository.save(any(TaskComment.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(userRepository.findById(200L))
            .thenReturn(Optional.of(new User("member@workflow.ai", "이서연", "demo", "2")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"확인했습니다"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.type").value("COMMENT"));

        verify(notificationService).notifyAfterCommit(eq(1L), eq(1L), eq("TASK_COMMENT"), any(), any(), eq("task"), any());
    }

    @Test
    void doesNotNotifyWhenAuthorIsTheAssignee() throws Exception {
        authenticateAs(1L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(existingTask()));
        when(taskCommentRepository.save(any(TaskComment.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(userRepository.findById(1L))
            .thenReturn(Optional.of(new User("assignee@workflow.ai", "박지수", "demo", "3")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"제가 담당자인데 셀프 코멘트 남깁니다"}
                    """))
            .andExpect(status().isOk());

        verify(notificationService, org.mockito.Mockito.never())
            .notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }
}
