package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class TaskControllerDeleteTest {

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

    private Task existingTask() {
        return new Task(
            1L, "삭제될 업무", "frontend", "todo", 3L,
            LocalDate.of(2026, 7, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void notifiesAssigneeOnDelete() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(delete("/api/v1/projects/demo-project/tasks/42"))
            .andExpect(status().isOk());

        // existingTask()의 담당자는 3L, currentActorId()는 mock "1" -> 1L 이라 서로 다르므로 알림 발생
        verify(notificationService).notifyAfterCommit(eq(3L), eq("TASK_DELETED"), any(), any(), eq("task"), any(), eq(1L));
        verify(ragIngestService).recordDeleteSourceIntent(1L, "task", 42L);
        verify(ragIngestService).deleteSourceBestEffort(1L, "task", 42L);
    }
}
