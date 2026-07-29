package com.workflowai.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationBroadcaster;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
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
class TaskControllerPositionTest {

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
    void memberCanMoveOwnTask() throws Exception {
        authenticateAs(3L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 3L))
            .thenReturn(Optional.of(new ProjectMember(1L, 3L, ProjectRole.MEMBER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"inprogress\",\"position\":1.0}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void memberCannotMoveOthersTask() throws Exception {
        authenticateAs(2L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 2L))
            .thenReturn(Optional.of(new ProjectMember(1L, 2L, ProjectRole.MEMBER)));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"inprogress\",\"position\":1.0}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_OWNER"));
    }

    @Test
    void leaderCanMoveAnyonesTask() throws Exception {
        authenticateAs(1L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"inprogress\",\"position\":1.0}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void notifiesAssigneeAndLeadersOnStatusChange() throws Exception {
        authenticateAs(1L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(
            new ProjectMember(1L, 1L, ProjectRole.LEADER),
            new ProjectMember(1L, 3L, ProjectRole.MEMBER)
        ));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"inprogress\",\"position\":1.0}"))
            .andExpect(status().isOk());

        // existingTask()의 담당자는 3L. actor(1L)는 팀장이지만 자기알림 제외 대상이라 알림 없음.
        verify(notificationService, times(1)).notifyAfterCommit(eq(3L), eq(1L), eq("STATUS_CHANGED"), any(), any(), eq("task"), any());
    }

    @Test
    void leaderNotificationIncludesMemberNameTaskAndNewStatus() throws Exception {
        authenticateAs(3L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 3L))
            .thenReturn(Optional.of(new ProjectMember(1L, 3L, ProjectRole.MEMBER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(
            new ProjectMember(1L, 1L, ProjectRole.LEADER),
            new ProjectMember(1L, 3L, ProjectRole.MEMBER)
        ));
        when(userRepository.findById(3L))
            .thenReturn(Optional.of(new User("member@example.com", "김민준", "local", "member-3")));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"inprogress\",\"position\":1.0}"))
            .andExpect(status().isOk());

        verify(notificationService).notifyAfterCommit(
            eq(1L),
            eq(1L),
            eq("STATUS_CHANGED"),
            eq("업무 상태가 변경되었습니다."),
            eq("김민준님이 '원래 제목' 업무를 '진행 중' 상태로 변경했습니다."),
            eq("task"),
            any()
        );
    }

    @Test
    void repeatedMoveToSameStatusCreatesOnlyOneLeaderNotification() throws Exception {
        authenticateAs(3L);
        Task task = existingTask();
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(42L)).thenReturn(Optional.of(task));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 3L))
            .thenReturn(Optional.of(new ProjectMember(1L, 3L, ProjectRole.MEMBER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(
            new ProjectMember(1L, 1L, ProjectRole.LEADER),
            new ProjectMember(1L, 3L, ProjectRole.MEMBER)
        ));
        when(userRepository.findById(3L))
            .thenReturn(Optional.of(new User("member@example.com", "김민준", "local", "member-3")));

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"inprogress\",\"position\":1.0}"))
                .andExpect(status().isOk());
        }

        verify(taskRepository, times(2)).findByIdForUpdate(42L);
        verify(notificationService, times(1)).notifyAfterCommit(
            eq(1L),
            eq(1L),
            eq("STATUS_CHANGED"),
            eq("업무 상태가 변경되었습니다."),
            eq("김민준님이 '원래 제목' 업무를 '진행 중' 상태로 변경했습니다."),
            eq("task"),
            any()
        );
    }

    @Test
    void blocksMovingTaskWhilePendingApproval() throws Exception {
        // 완료 승인 대기 중인 업무는 팀장이라도 승인/반려/취소 전에는 이동할 수 없어야 한다 -
        // 그렇지 않으면 pendingApproval=true인 채로 status만 바뀌어 정합성이 깨진다.
        authenticateAs(1L);
        Task task = existingTask();
        task.requestCompletion();
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(task));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"blocked\",\"position\":1.0}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("PENDING_APPROVAL"));

        verify(taskRepository, org.mockito.Mockito.never()).save(any());
    }

    @Test
    void doesNotNotifyWhenStatusUnchanged() throws Exception {
        authenticateAs(3L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByIdForUpdate(anyLong())).thenReturn(Optional.of(existingTask()));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 3L))
            .thenReturn(Optional.of(new ProjectMember(1L, 3L, ProjectRole.MEMBER)));
        when(taskRepository.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of(
            new ProjectMember(1L, 3L, ProjectRole.MEMBER),
            new ProjectMember(1L, 1L, ProjectRole.LEADER)
        ));

        mockMvc.perform(patch("/api/v1/projects/demo-project/tasks/42/position")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"todo\",\"position\":2.0}"))
            .andExpect(status().isOk());

        verify(notificationService, org.mockito.Mockito.never())
            .notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());

        // 상태 변경이 없어도 SSE task-move 브로드캐스트는 다른 프로젝트 멤버에게 항상 전송되어야 한다.
        verify(notificationBroadcaster).broadcast(eq(1L), eq("task-move"), any());
        verify(notificationBroadcaster, org.mockito.Mockito.never()).broadcast(eq(3L), any(), any());
    }
}
