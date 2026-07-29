package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.common.GlobalExceptionHandler;
import com.workflowai.notification.NotificationBroadcaster;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.User;
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
class TaskControllerUpdateTest {

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
    private NotificationBroadcaster notificationBroadcaster;

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
                notificationService, notificationBroadcaster, projectMemberRepository, projectRepository, ragIngestService
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

    private Task existingTask() {
        return new Task(
            1L, "원래 제목", "frontend", "todo", 3L,
            LocalDate.of(2026, 7, 1), "medium", "원래 설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void updatesTaskFields() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectRepository.findById(1L))
            .thenReturn(Optional.of(new Project("프로젝트", "team", LocalDate.of(2026, 8, 7), "")));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"새 제목","category":"backend","assigneeId":"5","dueDate":"2026-08-01","priority":"high","description":"새 설명"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.title").value("새 제목"))
            .andExpect(jsonPath("$.data.category").value("backend"))
            .andExpect(jsonPath("$.data.priority").value("high"))
            .andExpect(jsonPath("$.data.dueDate").value("2026-08-01"))
            .andExpect(jsonPath("$.data.assigneeId").value("5"))
            .andExpect(jsonPath("$.data.description").value("새 설명"));
    }

    @Test
    void rejectsBlankTitle() throws Exception {
        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("TITLE_REQUIRED"));
    }

    @Test
    void rejectsInvalidAssigneeIdFormat() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"not-a-number\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_ASSIGNEE_ID"));

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsInvalidDueDateFormat() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dueDate\":\"not-a-date\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_DUE_DATE"));
    }

    @Test
    void rejectsInvalidStartDateFormat() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"startDate\":\"not-a-date\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_START_DATE"));
    }

    @Test
    void rejectsStartDateAfterExistingDueDate() throws Exception {
        // existingTask()의 dueDate는 2026-07-01. startDate만 그보다 늦게 보내면
        // applyUpdate 적용 후 실제 값 기준(2026-07-15 > 2026-07-01)으로 막혀야 한다.
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectRepository.findById(1L)).thenReturn(Optional.of(new Project("프로젝트", "team", "")));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"startDate\":\"2026-07-15\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_DATE_RANGE"));

        verify(taskRepository, never()).save(any());
    }

    @Test
    void allowsStartDateOnOrBeforeDueDate() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectRepository.findById(1L)).thenReturn(Optional.of(new Project("프로젝트", "team", "")));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"startDate\":\"2026-06-01\",\"dueDate\":\"2026-07-01\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.startDate").value("2026-06-01"));
    }

    @Test
    void returnsNotFoundWhenTaskMissing() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.empty());

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/999")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"아무거나\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("TASK_NOT_FOUND"));
    }

    @Test
    void notifiesNewAssigneeWhenAssigneeChanges() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"5\"}"))
            .andExpect(status().isOk());

        verify(notificationService).notifyAfterCommit(eq(5L), eq(1L), eq("TASK_ASSIGNED"), any(), any(), eq("task"), any());
    }

    @Test
    void syncsRagAssigneeMetadataWhenAssigneeChanges() throws Exception {
        // 담당자가 재배정된 뒤에도 RAG 검색이 옛 담당자에게 계속 걸리지 않도록,
        // 기존 인제스트된 청크의 assignee_id를 동기화하는 호출이 나가야 한다.
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"5\"}"))
            .andExpect(status().isOk());

        verify(ragIngestService).recordAssigneeSyncIntent(1L, "task", 42L, 5L);
        verify(ragIngestService).syncAssigneeBestEffort(1L, "task", 42L, 5L);
    }

    @Test
    void notifiesAssigneeWhenOtherFieldsChange() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"새 제목\"}"))
            .andExpect(status().isOk());

        // existingTask()의 담당자는 3L
        verify(notificationService).notifyAfterCommit(eq(3L), eq(1L), eq("TASK_UPDATED"), any(), any(), eq("task"), any());
        verify(ragIngestService).ingestBestEffort(1L, "task", null, "새 제목 - 원래 설명", 3L);
    }

    @Test
    void doesNotNotifyWhenNothingChanges() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk());

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void notifiesPreviousAssigneeWhenTaskIsReassigned() throws Exception {
        // 새 담당자만 알리면, 업무가 자기 목록에서 사라진 사람은 그 사실을 어디서도 통보받지
        // 못한다. RAG 쪽은 syncAssigneeBestEffort로 이미 떼어내는데 알림만 그 대칭이 없었다.
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userRepository.findById(5L)).thenReturn(Optional.of(userNamed("이영희")));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"5\"}"))
            .andExpect(status().isOk());

        // 이전 담당자(3L)와 새 담당자(5L) 양쪽에 가야 한다. 한쪽만 검증하면 반대쪽이
        // 빠져도 통과하므로 둘 다 못 박는다.
        verify(notificationService).notifyAfterCommit(eq(5L), eq(1L), eq("TASK_ASSIGNED"), any(), any(), eq("task"), any());
        verify(notificationService).notifyAfterCommit(
            eq(3L), eq(1L), eq("TASK_UNASSIGNED"), any(),
            // 누구에게 넘어갔는지가 본문에 있어야 이전 담당자가 인수인계 상대를 안다.
            contains("이영희"), eq("task"), any()
        );
    }

    @Test
    void doesNotNotifyPreviousAssigneeWhenTheyHandedItOffThemselves() throws Exception {
        // 자기가 자기 업무를 남에게 넘긴 경우다. 기존 알림들과 같은 규칙을 따른다.
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(3L, "user3@workflow.ai", "원담당자"), null, List.of()
            )
        );
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(existingTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"5\"}"))
            .andExpect(status().isOk());

        verify(notificationService, never()).notifyAfterCommit(
            eq(3L), any(), eq("TASK_UNASSIGNED"), any(), any(), any(), any()
        );
        // 새 담당자에게는 그대로 가야 한다(위 규칙이 알림 전체를 막아버리지 않았는지 확인).
        verify(notificationService).notifyAfterCommit(eq(5L), eq(1L), eq("TASK_ASSIGNED"), any(), any(), eq("task"), any());
    }

    @Test
    void doesNotNotifyAnyoneAsPreviousAssigneeWhenTaskHadNone() throws Exception {
        // 담당자가 없던 업무에 처음 배정하는 경우. 이전 담당자가 없으므로 TASK_UNASSIGNED는
        // 나가면 안 된다(null 담당자에게 알림을 보내려 하면 저장 단계에서 터진다).
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(anyLong())).thenReturn(Optional.of(unassignedTask()));
        when(taskRepository.save(any(Task.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"5\"}"))
            .andExpect(status().isOk());

        verify(notificationService).notifyAfterCommit(eq(5L), eq(1L), eq("TASK_ASSIGNED"), any(), any(), eq("task"), any());
        verify(notificationService, never()).notifyAfterCommit(
            any(), any(), eq("TASK_UNASSIGNED"), any(), any(), any(), any()
        );
    }

    private Task unassignedTask() {
        return new Task(
            1L, "담당자 없는 업무", "frontend", "todo", null,
            LocalDate.of(2026, 7, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    private User userNamed(String name) {
        return new User(name + "@workflow.ai", name, "local", name);
    }
}
