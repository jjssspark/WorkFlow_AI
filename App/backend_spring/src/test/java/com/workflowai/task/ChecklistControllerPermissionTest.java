package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.security.UserPrincipal;
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
class ChecklistControllerPermissionTest {

    @Mock
    private ChecklistRepository checklistRepository;

    @Mock
    private TaskRepository taskRepository;

    @Mock
    private DemoDataService demoDataService;

    @Mock
    private ActivityService activityService;

    @Mock
    private ChecklistAiService checklistAiService;

    @Mock
    private ChecklistApplyService checklistApplyService;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ChecklistController(
                checklistRepository, taskRepository, demoDataService, activityService,
                checklistAiService, checklistApplyService, projectMemberRepository
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

    /** 담당자 3L인 업무. */
    private Task taskAssignedTo3() {
        return new Task(
            1L, "제목", "backend", "todo", 3L,
            LocalDate.of(2026, 7, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void assigneeCanCreateChecklistItem() throws Exception {
        authenticateAs(3L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskAssignedTo3()));
        when(checklistRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/5/checklists")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"테스트 항목\"}"))
            .andExpect(status().isOk());
    }

    @Test
    void nonAssigneeNonLeaderCannotCreateChecklistItem() throws Exception {
        authenticateAs(999L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskAssignedTo3()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 999L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/5/checklists")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"테스트 항목\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_OWNER"));

        verify(checklistRepository, never()).save(any());
    }

    @Test
    void nonAssigneeNonLeaderCannotToggleChecklistItem() throws Exception {
        authenticateAs(999L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskAssignedTo3()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 999L)).thenReturn(Optional.empty());

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/5/checklists/9")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"done\":true}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_OWNER"));

        verify(checklistRepository, never()).save(any());
    }

    @Test
    void nonAssigneeNonLeaderCannotDeleteChecklistItem() throws Exception {
        authenticateAs(999L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(taskAssignedTo3()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 999L)).thenReturn(Optional.empty());

        mockMvc.perform(delete("/api/v1/projects/demo-project/tasks/5/checklists/9"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_OWNER"));

        verify(checklistRepository, never()).delete(any());
    }
}
