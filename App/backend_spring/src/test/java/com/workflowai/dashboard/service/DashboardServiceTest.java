package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

import com.workflowai.activity.ActivityRepository;
import com.workflowai.common.DemoDataService;
import com.workflowai.dashboard.DTO.DashboardAiJobResponse;
import com.workflowai.dashboard.DTO.DashboardSummaryResponse;
import com.workflowai.dashboard.DTO.DashboardTaskDto;
import com.workflowai.dashboard.DTO.DelayRiskDto;
import com.workflowai.dashboard.DTO.MilestoneProgressDto;
import com.workflowai.dashboard.DTO.ProgressDetailResponse;
import com.workflowai.dashboard.DTO.WorkloadScoreMemberDto;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import com.workflowai.dashboard.entity.Milestone;
import com.workflowai.dashboard.entity.MlPrediction;
import com.workflowai.dashboard.repository.MilestoneRepository;
import com.workflowai.dashboard.repository.MlPredictionRepository;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.UserRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class DashboardServiceTest {

    @Mock private TaskRepository taskRepository;
    @Mock private MilestoneRepository milestoneRepository;
    @Mock private ActivityRepository activityRepository;
    @Mock private MlPredictionRepository mlPredictionRepository;
    @Mock private UserRepository userRepository;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private DemoDataService demoDataService;
    @Mock private FastApiWorkloadScoreClient fastApiWorkloadScoreClient;
    @Mock private ProjectRepository projectRepository;
    @Mock private NotificationService notificationService;
    @Mock private DashboardAiJobPublisher dashboardAiJobPublisher;
    @Mock private DashboardWorkloadScoreCache workloadScoreCache;

    private DashboardService newService() {
        return new DashboardService(
            taskRepository, milestoneRepository, activityRepository, mlPredictionRepository,
            userRepository, projectMemberRepository, demoDataService,
            fastApiWorkloadScoreClient, projectRepository, notificationService,
            dashboardAiJobPublisher, workloadScoreCache
        );
    }

    private Task taskWithId(Long id, Long assigneeId) {
        Task task = new Task(
            1L, "제목 " + id, "backend", "inprogress", assigneeId,
            LocalDate.of(2026, 8, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
        ReflectionTestUtils.setField(task, "id", id);
        return task;
    }

    private MlPrediction predictionFor(Long taskId, String result) {
        MlPrediction prediction = newMlPrediction();
        ReflectionTestUtils.setField(prediction, "targetId", taskId);
        ReflectionTestUtils.setField(prediction, "result", result);
        ReflectionTestUtils.setField(prediction, "score", new BigDecimal("0.80"));
        ReflectionTestUtils.setField(prediction, "createdAt", LocalDateTime.of(2026, 7, 20, 9, 0));
        return prediction;
    }

    private MlPrediction newMlPrediction() {
        try {
            var constructor = MlPrediction.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            return constructor.newInstance();
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void getMyDelayRisksReturnsOnlyTasksAssignedToGivenUser() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task myTask = taskWithId(10L, 5L);
        Task otherTask = taskWithId(11L, 6L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(myTask, otherTask));
        when(mlPredictionRepository.findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
            eq(1L), eq("task"), eq("delay_risk")
        )).thenReturn(List.of(predictionFor(10L, "위험"), predictionFor(11L, "위험")));

        List<DelayRiskDto> result = newService().getMyDelayRisks("demo-project", 5L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).taskId()).isEqualTo("10");
    }

    @Test
    void getMyDelayRisksExcludesNormalResult() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task myTask = taskWithId(10L, 5L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(myTask));
        when(mlPredictionRepository.findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
            eq(1L), eq("task"), eq("delay_risk")
        )).thenReturn(List.of(predictionFor(10L, "정상")));

        List<DelayRiskDto> result = newService().getMyDelayRisks("demo-project", 5L);

        assertThat(result).isEmpty();
    }

    @Test
    void getMyDelayRisksSkipsUnassignedTasks() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task unassigned = taskWithId(10L, null);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(unassigned));
        when(mlPredictionRepository.findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
            eq(1L), eq("task"), eq("delay_risk")
        )).thenReturn(List.of(predictionFor(10L, "위험")));

        List<DelayRiskDto> result = newService().getMyDelayRisks("demo-project", 5L);

        assertThat(result).isEmpty();
    }

    @Test
    void getTasksIncludesCreatedAtAndUpdatedAt() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Task task = taskWithId(10L, 5L);
        ReflectionTestUtils.setField(task, "createdAt", LocalDateTime.of(2026, 7, 1, 9, 0));
        ReflectionTestUtils.setField(task, "updatedAt", LocalDateTime.of(2026, 7, 19, 15, 30));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(task));

        List<DashboardTaskDto> result = newService().getTasks("demo-project");

        assertThat(result).hasSize(1);
        // UtcTimeFormat이 서버 시각(UTC)임을 명시하기 위해 "Z"를 붙인다 - new Date(iso)가 브라우저 로컬시간으로 오해석하는 것을 막는다.
        assertThat(result.get(0).createdAt()).isEqualTo("2026-07-01T09:00:00.000Z");
        assertThat(result.get(0).updatedAt()).isEqualTo("2026-07-19T15:30:00.000Z");
    }

    @Test
    void getSummaryIncludesAssigneeIdForUpcomingTasks() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(taskWithId(10L, 5L)));
        when(activityRepository.findTop10ByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of());
        when(userRepository.findAllById(List.of(5L))).thenReturn(List.of());

        DashboardSummaryResponse result = newService().getSummary("demo-project");

        assertThat(result.upcomingDeadlines()).hasSize(1);
        assertThat(result.upcomingDeadlines().get(0).assigneeId()).isEqualTo("5");
    }

    @Test
    void getProgressDetailIncludesProjectDeadlineAndCreatedAt() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of());
        when(mlPredictionRepository.findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
            eq(1L), eq("task"), eq("delay_risk")
        )).thenReturn(List.of());
        Project project = new Project("스마트 주차 관리 시스템", "team", LocalDate.of(2026, 8, 15), "설명");
        ReflectionTestUtils.setField(project, "createdAt", LocalDateTime.of(2026, 6, 1, 10, 0));
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project));

        ProgressDetailResponse result = newService().getProgressDetail("demo-project");

        assertThat(result.projectDeadline()).isEqualTo("2026-08-15");
        assertThat(result.projectCreatedAt()).isEqualTo("2026-06-01");
    }

    @Test
    void getProgressDetailReturnsNullDatesWhenProjectMissing() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of());
        when(mlPredictionRepository.findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
            eq(1L), eq("task"), eq("delay_risk")
        )).thenReturn(List.of());
        when(projectRepository.findById(1L)).thenReturn(Optional.empty());

        ProgressDetailResponse result = newService().getProgressDetail("demo-project");

        assertThat(result.projectDeadline()).isNull();
        assertThat(result.projectCreatedAt()).isNull();
    }

    @Test
    void createMilestoneSavesAndReturnsZeroProgress() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Milestone saved = new Milestone(1L, "MVP 발표", null, LocalDate.of(2026, 8, 15));
        ReflectionTestUtils.setField(saved, "id", 42L);
        when(milestoneRepository.save(any(Milestone.class))).thenReturn(saved);

        MilestoneProgressDto result = newService().createMilestone("demo-project", "MVP 발표", null, LocalDate.of(2026, 8, 15));

        assertThat(result.id()).isEqualTo("42");
        assertThat(result.title()).isEqualTo("MVP 발표");
        assertThat(result.dueDate()).isEqualTo("2026-08-15");
        assertThat(result.taskCount()).isEqualTo(0);
        assertThat(result.progressPercent()).isEqualTo(0);
    }

    @Test
    void deleteMilestoneUnlinksTasksBeforeDeletingMilestone() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        Milestone milestone = new Milestone(1L, "MVP 발표", null, LocalDate.of(2026, 8, 15));
        ReflectionTestUtils.setField(milestone, "id", 42L);
        when(milestoneRepository.findById(42L)).thenReturn(Optional.of(milestone));
        when(projectMemberRepository.findAllByProjectId(1L)).thenReturn(List.of());

        newService().deleteMilestone("demo-project", 42L);

        InOrder deletionOrder = inOrder(taskRepository, milestoneRepository);
        deletionOrder.verify(taskRepository).clearMilestoneId(1L, 42L);
        deletionOrder.verify(milestoneRepository).delete(milestone);
    }

    @Test
    void getWorkloadScoreFetchesLiveAndWarmsCacheWhenCacheMissing() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(workloadScoreCache.get(1L)).thenReturn(Optional.empty());
        WorkloadScoreResponseDto response = new WorkloadScoreResponseDto(
            "1.0", 1L, "db", "MAD (소규모 팀)",
            List.of(new WorkloadScoreMemberDto("5", 12, 0.4, 88.5, true, "과부하 의심", 1.8, 1.2, 3)),
            null, 0.62, null
        );
        WorkloadScoreResponseDto stamped = response.withCalculatedAt("2026-07-29T00:00:00Z");
        when(fastApiWorkloadScoreClient.fetch(1L)).thenReturn(response);
        when(workloadScoreCache.put(1L, response)).thenReturn(stamped);

        WorkloadScoreResponseDto result = newService().getWorkloadScore("demo-project");

        assertThat(result.members()).hasSize(1);
        assertThat(result.members().get(0).anomaly_type()).isEqualTo("과부하 의심");
        assertThat(result.team_mean_completion()).isEqualTo(0.62);
        // 라이브 계산 결과도 캐시에 넣으면서 찍힌 계산 시각을 그대로 응답에 실어야 한다.
        assertThat(result.calculated_at()).isEqualTo("2026-07-29T00:00:00Z");
        verify(workloadScoreCache).put(1L, response);
    }

    @Test
    void getWorkloadScoreReturnsCachedValueWithoutCallingFastApi() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        WorkloadScoreResponseDto cached = new WorkloadScoreResponseDto(
            "1.0", 1L, "db", "MAD (소규모 팀)", List.of(), null, 0.5, "2026-07-01T09:00:00Z"
        );
        when(workloadScoreCache.get(1L)).thenReturn(Optional.of(cached));

        WorkloadScoreResponseDto result = newService().getWorkloadScore("demo-project");

        assertThat(result).isSameAs(cached);
        assertThat(result.calculated_at()).isEqualTo("2026-07-01T09:00:00Z");
        verify(fastApiWorkloadScoreClient, never()).fetch(any());
    }

    @Test
    void enqueueDelayRiskRefreshDelegatesToPublisherAndReturnsProcessingStatus() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(dashboardAiJobPublisher.enqueue(1L, DashboardAiJobType.DELAY_RISK, 5L)).thenReturn("job-1");

        DashboardAiJobResponse result = newService().enqueueDelayRiskRefresh("demo-project", 5L);

        assertThat(result.jobId()).isEqualTo("job-1");
        assertThat(result.projectId()).isEqualTo("demo-project");
        assertThat(result.jobType()).isEqualTo("DELAY_RISK");
        assertThat(result.status()).isEqualTo("PROCESSING");
    }

    @Test
    void getDelayRiskRefreshStatusReturnsDoneWhenJobFinishedSuccessfully() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(dashboardAiJobPublisher.isJobActive(1L, DashboardAiJobType.DELAY_RISK, "job-1")).thenReturn(false);
        when(dashboardAiJobPublisher.isJobDone(1L, DashboardAiJobType.DELAY_RISK, "job-1")).thenReturn(true);

        DashboardAiJobResponse result = newService().getDelayRiskRefreshStatus("demo-project", "job-1");

        assertThat(result.status()).isEqualTo("DONE");
    }

    @Test
    void getDelayRiskRefreshStatusReturnsFailedWhenJobNeitherActiveNorDone() {
        // in-flight 마커가 TTL 만료/재시도 대기 등으로 사라졌을 뿐 실제로 완료되지 않은 경우 —
        // 예전에는 이 상태를 DONE으로 잘못 보고했다.
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(dashboardAiJobPublisher.isJobActive(1L, DashboardAiJobType.DELAY_RISK, "job-1")).thenReturn(false);
        when(dashboardAiJobPublisher.isJobDone(1L, DashboardAiJobType.DELAY_RISK, "job-1")).thenReturn(false);

        DashboardAiJobResponse result = newService().getDelayRiskRefreshStatus("demo-project", "job-1");

        assertThat(result.status()).isEqualTo("FAILED");
    }
}
