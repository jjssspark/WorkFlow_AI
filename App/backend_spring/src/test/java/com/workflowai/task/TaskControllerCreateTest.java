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
import com.workflowai.common.GlobalExceptionHandler;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.UserRepository;
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
class TaskControllerCreateTest {

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
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(1L, "user1@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void notifiesAssigneeOnCreate() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(anyLong(), any()))
            .thenReturn(java.util.Optional.empty());
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"새 업무","category":"backend","assigneeId":"5"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(notificationService).notifyAfterCommit(
            eq(5L), eq("TASK_ASSIGNED"), any(), any(), eq("task"), any()
        );
        verify(ragIngestService).ingestBestEffort(1L, "task", null, "새 업무", 5L);
    }

    @Test
    void createsTaskWithStartDate() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(anyLong(), any()))
            .thenReturn(java.util.Optional.empty());
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectRepository.findById(1L)).thenReturn(Optional.of(new Project("데모", "team", "설명")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"새 업무","category":"backend","startDate":"2026-07-01","dueDate":"2026-07-10"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.startDate").value("2026-07-01"))
            .andExpect(jsonPath("$.data.dueDate").value("2026-07-10"));
    }

    @Test
    void rejectsStartDateAfterDueDate() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(new Project("데모", "team", "설명")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"새 업무","category":"backend","startDate":"2026-07-10","dueDate":"2026-07-01"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_DATE_RANGE"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void rejectsInvalidAssigneeIdFormat() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"새 업무","category":"backend","assigneeId":"not-a-number"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_ASSIGNEE_ID"));

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }

    @Test
    void doesNotNotifyWhenNoAssignee() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(anyLong(), any()))
            .thenReturn(java.util.Optional.empty());
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"담당자 없는 업무","category":"backend"}
                    """))
            .andExpect(status().isOk());

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
    }
}
