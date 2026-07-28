package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class TaskControllerCompletionApprovalTest {

    @Mock
    private TaskRepository taskRepository;

    @Mock
    private DemoDataService demoDataService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private ActivityService activityService;

    @Mock
    private NotificationService notificationService;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private RagIngestService ragIngestService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new TaskController(
                taskRepository, userRepository, demoDataService, activityService,
                notificationService, projectMemberRepository, projectRepository, ragIngestService
            ))
            .build();
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private void loginAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    /** 담당자 3L, 아직 완료 승인 대기 중이 아닌 진행 중 업무. */
    private Task inProgressTask() {
        return taskWithStatus("inprogress");
    }

    private Task taskWithStatus(String status) {
        return new Task(
            1L, "결제 연동", "backend", status, 3L,
            LocalDate.of(2026, 7, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    private ProjectMember leaderMember(Long userId) {
        return new ProjectMember(1L, userId, ProjectRole.LEADER);
    }

    @Test
    void assigneeCanRequestCompletion() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task task = inProgressTask();
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(task));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(leaderMember(9L)));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-request"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.pendingApproval").value(true))
            .andExpect(jsonPath("$.data.status").value("inprogress"));

        assertThat(task.isPendingApproval()).isTrue();
        verify(activityService).record(eq(1L), eq(3L), eq("COMPLETION_REQUESTED"), any(), any());
        verify(notificationService).notifyAfterCommit(eq(9L), eq(1L), eq("COMPLETION_REQUESTED"), any(), any(), eq("task"), any());
    }

    @Test
    void cannotRequestCompletionForTodoTask() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskWithStatus("todo")));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-request"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_STATUS_FOR_COMPLETION"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void cannotRequestCompletionForBlockedTask() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskWithStatus("blocked")));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-request"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_STATUS_FOR_COMPLETION"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void cannotRequestCompletionForAlreadyDoneTask() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskWithStatus("done")));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-request"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_STATUS_FOR_COMPLETION"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void nonAssigneeCannotRequestCompletion() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(inProgressTask()));
        loginAs(999L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-request"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_OWNER"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void assigneeCanCancelOwnPendingRequest() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task task = inProgressTask();
        task.requestCompletion();
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(task));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-cancel"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.pendingApproval").value(false));

        assertThat(task.isPendingApproval()).isFalse();
        assertThat(task.getStatus()).isEqualTo("inprogress");
    }

    @Test
    void cancelFailsWhenNotPending() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(inProgressTask()));
        loginAs(3L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-cancel"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("NOT_PENDING"));
    }

    @Test
    void leaderApprovalMovesTaskToDone() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task task = inProgressTask();
        task.requestCompletion();
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(task));
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(1L, "done")).thenReturn(Optional.empty());
        loginAs(1L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-approve"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("done"))
            .andExpect(jsonPath("$.data.pendingApproval").value(false));

        assertThat(task.getStatus()).isEqualTo("done");
        assertThat(task.isPendingApproval()).isFalse();
        verify(notificationService).notifyAfterCommit(eq(3L), eq(1L), eq("COMPLETION_APPROVED"), any(), any(), eq("task"), any());
    }

    @Test
    void leaderRejectionKeepsPreviousStatus() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task task = inProgressTask();
        task.requestCompletion();
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(task));
        loginAs(1L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/completion-reject"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("inprogress"))
            .andExpect(jsonPath("$.data.pendingApproval").value(false));

        assertThat(task.getStatus()).isEqualTo("inprogress");
        verify(notificationService).notifyAfterCommit(eq(3L), eq(1L), eq("COMPLETION_REJECTED"), any(), any(), eq("task"), any());
    }
}
