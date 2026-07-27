package com.workflowai.task;

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
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class TaskControllerNudgeTest {

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

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    private Task existingTask() {
        return new Task(
            1L, "원래 제목", "frontend", "todo", 3L,
            LocalDate.of(2026, 7, 1), "medium", "원래 설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void sendsStartNudgeToAssignee() throws Exception {
        authenticateAs(2L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"START\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(notificationService).notifyAfterCommit(eq(3L), eq("TASK_NUDGE"), any(), any(), eq("task"), any());
    }

    @Test
    void sendsProgressNudgeToAssignee() throws Exception {
        authenticateAs(2L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"PROGRESS\"}"))
            .andExpect(status().isOk());

        verify(notificationService).notifyAfterCommit(eq(3L), eq("TASK_NUDGE"), any(), any(), eq("task"), any());
    }

    @Test
    void sendsUrgentNudgeToAssignee() throws Exception {
        authenticateAs(2L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"URGENT\"}"))
            .andExpect(status().isOk());

        verify(notificationService).notifyAfterCommit(eq(3L), eq("TASK_NUDGE"), any(), any(), eq("task"), any());
    }

    @Test
    void rejectsUnknownNudgeKind() throws Exception {
        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"NOT_A_KIND\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_NUDGE_KIND"));

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsMissingNudgeKind() throws Exception {
        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_NUDGE_KIND"));

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsBlankNudgeKind() throws Exception {
        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"  \"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_NUDGE_KIND"));

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }

    @Test
    void returnsNotFoundWhenTaskMissing() throws Exception {
        authenticateAs(2L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/999/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"START\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("TASK_NOT_FOUND"));
    }

    @Test
    void doesNotNotifyWhenActorIsTheAssignee() throws Exception {
        authenticateAs(3L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/nudge")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"START\"}"))
            .andExpect(status().isOk());

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }
}
