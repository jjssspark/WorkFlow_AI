package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.UserPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ChecklistController.class)
@AutoConfigureMockMvc(addFilters = false)
class ChecklistControllerGenerateTest {

    @Autowired private MockMvc mockMvc;
    @MockitoBean private ChecklistRepository checklistRepository;
    @MockitoBean private TaskRepository taskRepository;
    @MockitoBean private DemoDataService demoDataService;
    @MockitoBean private ActivityService activityService;
    @MockitoBean private ChecklistAiService checklistAiService;
    @MockitoBean private ChecklistApplyService checklistApplyService;
    @MockitoBean private ProjectMemberRepository projectMemberRepository;

    @BeforeEach
    void setUp() {
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

    private Task taskWithProject(Long projectId) {
        return new Task(projectId, "로그인 API", "backend", "todo", null,
            LocalDate.parse("2026-08-01"), "HIGH", "설명", null, null, 1L, 0.0);
    }

    @Test
    void generatePreviewReturnsTitlesWithoutSaving() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(5L)).thenReturn(Optional.of(taskWithProject(1L)));
        when(checklistRepository.findByTaskIdOrderByCreatedAtAsc(5L)).thenReturn(List.of());
        when(checklistAiService.generatePreview(any(), any()))
            .thenReturn(new ChecklistPreviewResult(List.of("API 설계", "구현"), "ollama"));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/5/checklists/generate-preview"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.engine").value("ollama"))
            .andExpect(jsonPath("$.data.titles[0]").value("API 설계"));

        verify(checklistRepository, never()).save(any());
    }

    @Test
    void generatePreviewReturns404WhenTaskMissing() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(999L)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/999/checklists/generate-preview"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("TASK_NOT_FOUND"));
    }

    @Test
    void applyGeneratedSavesNormalizedTitles() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));
        when(taskRepository.findById(5L)).thenReturn(Optional.of(taskWithProject(1L)));
        when(checklistApplyService.saveGenerated(any(), any())).thenReturn(List.of(new Checklist(5L, "API 설계")));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/5/checklists/apply-generated")
                .contentType(MediaType.APPLICATION_JSON).content("{\"titles\":[\"API 설계\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].title").value("API 설계"));

        verify(checklistApplyService).saveGenerated(any(), any());
        verify(activityService).record(any(), any(), any(), any(), any());
    }

    @Test
    void applyGeneratedReturns400WhenNoValidTitles() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));
        when(taskRepository.findById(5L)).thenReturn(Optional.of(taskWithProject(1L)));
        when(checklistApplyService.saveGenerated(any(), any())).thenReturn(List.of());

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/5/checklists/apply-generated")
                .contentType(MediaType.APPLICATION_JSON).content("{\"titles\":[\" \"]}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("NO_ITEMS"));
    }
}
