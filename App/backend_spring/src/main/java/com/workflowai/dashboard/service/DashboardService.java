package com.workflowai.dashboard.service;

import com.workflowai.common.DemoDataService;
import com.workflowai.common.UtcTimeFormat;
import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import com.workflowai.dashboard.DTO.ActivityItemDto;
import com.workflowai.dashboard.DTO.CategoryProgressDto;
import com.workflowai.dashboard.DTO.DashboardTaskDto;
import com.workflowai.dashboard.DTO.DashboardSummaryResponse;
import com.workflowai.dashboard.DTO.DelayRiskDto;
import com.workflowai.dashboard.DTO.MilestoneProgressDto;
import com.workflowai.dashboard.DTO.ProgressDetailResponse;
import com.workflowai.dashboard.DTO.UpcomingTaskDto;
import com.workflowai.dashboard.DTO.WorkloadEntryDto;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import com.workflowai.dashboard.entity.Milestone;
import com.workflowai.dashboard.entity.MlPrediction;
import com.workflowai.dashboard.repository.MilestoneRepository;
import com.workflowai.dashboard.repository.MlPredictionRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
    private static final Logger log = LoggerFactory.getLogger(DashboardService.class);

    private static final String STATUS_DONE = "done";
    private static final String STATUS_INPROGRESS = "inprogress";
    private static final String STATUS_BLOCKED = "blocked";

    private static final String TARGET_TYPE_TASK = "task";
    private static final String MODEL_TYPE_DELAY_RISK = "delay_risk";
    private static final String RISK_RESULT_NORMAL = "정상";

    private final TaskRepository taskRepository;
    private final MilestoneRepository milestoneRepository;
    private final ActivityRepository activityRepository;
    private final MlPredictionRepository mlPredictionRepository;
    private final UserRepository userRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final DemoDataService demoDataService;
    private final FastApiDashboardClient fastApiDashboardClient;
    private final FastApiWorkloadScoreClient fastApiWorkloadScoreClient;
    private final ProjectRepository projectRepository;

    public DashboardService(
        TaskRepository taskRepository,
        MilestoneRepository milestoneRepository,
        ActivityRepository activityRepository,
        MlPredictionRepository mlPredictionRepository,
        UserRepository userRepository,
        ProjectMemberRepository projectMemberRepository,
        DemoDataService demoDataService,
        FastApiDashboardClient fastApiDashboardClient,
        FastApiWorkloadScoreClient fastApiWorkloadScoreClient,
        ProjectRepository projectRepository
    ) {
        this.taskRepository = taskRepository;
        this.milestoneRepository = milestoneRepository;
        this.activityRepository = activityRepository;
        this.mlPredictionRepository = mlPredictionRepository;
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.demoDataService = demoDataService;
        this.fastApiDashboardClient = fastApiDashboardClient;
        this.fastApiWorkloadScoreClient = fastApiWorkloadScoreClient;
        this.projectRepository = projectRepository;
    }

    public DashboardSummaryResponse getSummary(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        long total = tasks.size();
        long done = tasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long blocked = tasks.stream().filter(t -> STATUS_BLOCKED.equals(t.getStatus())).count();
        long inProgress = tasks.stream().filter(t -> STATUS_INPROGRESS.equals(t.getStatus())).count();
        long progressPercent = total == 0 ? 0 : Math.round(done * 100.0 / total);

        List<UpcomingTaskDto> upcoming = tasks.stream()
            .filter(t -> !STATUS_DONE.equals(t.getStatus()))
            .sorted(Comparator.comparing(Task::getDueDate, Comparator.nullsLast(Comparator.naturalOrder())))
            .limit(5)
            .map(t -> new UpcomingTaskDto(
                String.valueOf(t.getId()),
                t.getTitle(),
                t.getStatus(),
                t.getDueDate() == null ? null : t.getDueDate().toString(),
                resolveUserName(t.getAssigneeId())
            ))
            .toList();

        List<WorkloadEntryDto> workload = buildWorkload(projectId, tasks);

        List<ActivityItemDto> recentActivity = activityRepository
            .findTop10ByProjectIdOrderByCreatedAtDesc(projectId)
            .stream()
            .map(this::toActivityItemDto)
            .toList();

        return new DashboardSummaryResponse(total, done, progressPercent, blocked, inProgress, upcoming, workload, recentActivity);
    }

    public List<DashboardTaskDto> getTasks(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        return taskRepository.findByProjectIdOrderByStatusAscPositionAsc(projectId).stream()
            .map(this::toDashboardTaskDto)
            .toList();
    }

    public List<ActivityItemDto> getActivities(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        return activityRepository.findTop50ByProjectIdOrderByCreatedAtDesc(projectId).stream()
            .map(this::toActivityItemDto)
            .toList();
    }

    public ProgressDetailResponse getProgressDetail(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        long total = tasks.size();
        long done = tasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long progressPercent = total == 0 ? 0 : Math.round(done * 100.0 / total);

        List<MilestoneProgressDto> milestones = buildMilestoneProgress(projectId, tasks);
        List<CategoryProgressDto> categoryBreakdown = buildCategoryBreakdown(tasks);

        List<MlPrediction> latestPredictions = latestPredictionsByTarget(projectId);
        boolean hasPredictions = !latestPredictions.isEmpty();

        Map<Long, Task> tasksById = new LinkedHashMap<>();
        tasks.forEach(t -> tasksById.put(t.getId(), t));

        List<DelayRiskDto> delayRisks = latestPredictions.stream()
            .filter(p -> !RISK_RESULT_NORMAL.equals(p.getResult()))
            .map(p -> toDelayRiskDto(p, tasksById.get(p.getTargetId())))
            .filter(java.util.Objects::nonNull)
            .toList();

        Project project = projectRepository.findById(projectId).orElse(null);
        String projectDeadline = project == null || project.getDeadline() == null
            ? null : project.getDeadline().toString();
        String projectCreatedAt = project == null || project.getCreatedAt() == null
            ? null : project.getCreatedAt().toLocalDate().toString();

        return new ProgressDetailResponse(
            total, done, progressPercent, milestones, categoryBreakdown, delayRisks, hasPredictions,
            projectDeadline, projectCreatedAt
        );
    }

    /**
     * 현재 로그인한 사용자가 담당자(assignee)인 업무 중, AI 지연 위험도가 '정상'이 아닌
     * 업무만 골라 반환한다. 새 모델이나 새 ml_predictions 행 타입이 필요한 게 아니라,
     * getProgressDetail()이 만드는 것과 동일한 업무별(target_type='task') 최신 예측을
     * 담당자 기준으로 한 번 더 걸러내는 조회다.
     */
    public List<DelayRiskDto> getMyDelayRisks(String projectIdParam, Long userId) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        Map<Long, Task> tasksById = new LinkedHashMap<>();
        tasks.forEach(t -> tasksById.put(t.getId(), t));

        return latestPredictionsByTarget(projectId).stream()
            .filter(p -> !RISK_RESULT_NORMAL.equals(p.getResult()))
            .map(p -> toDelayRiskDtoForAssignee(p, tasksById.get(p.getTargetId()), userId))
            .filter(java.util.Objects::nonNull)
            .toList();
    }

    /** 마일스톤을 새로 만들고, 방금 만든 마일스톤을 진행률 0%인 MilestoneProgressDto로 반환한다. */
    public MilestoneProgressDto createMilestone(String projectIdParam, String title, java.time.LocalDate dueDate) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Milestone saved = milestoneRepository.save(new Milestone(projectId, title, dueDate));
        return toMilestoneProgressDto(saved, List.of());
    }

    /** FastAPI에 재예측을 요청한 뒤(베스트-에포트) 최신 진행률 상세를 반환한다. */
    public ProgressDetailResponse refreshDelayRiskAndGetProgress(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        try {
            fastApiDashboardClient.refreshDelayRisk(projectId);
        } catch (Exception e) {
            // FastAPI가 내려가 있어도 대시보드 자체는 계속 떠야 하므로, 여기서 예외를 삼키고
            // ml_predictions에 이미 저장돼 있던 마지막 예측 결과로 계속 진행한다.
            log.warn("지연 위험도 재예측 요청 실패 (project_id={}): {}", projectId, e.getMessage());
        }
        return getProgressDetail(projectIdParam);
    }

    /** ml_workload_score(FastAPI)가 계산한 팀원별 업무 편중(과부하/저활동) 점수를 그대로 가져온다.
     * ml_predictions처럼 DB에 저장해두고 읽는 게 아니라 호출 시점에 즉시 계산되는 라이브 조회다. */
    public WorkloadScoreResponseDto getWorkloadScore(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        return fastApiWorkloadScoreClient.fetch(projectId);
    }

    private List<WorkloadEntryDto> buildWorkload(Long projectId, List<Task> tasks) {
        Map<Long, List<Task>> byAssignee = new LinkedHashMap<>();
        for (Task task : tasks) {
            if (task.getAssigneeId() == null) {
                continue;
            }
            byAssignee.computeIfAbsent(task.getAssigneeId(), k -> new ArrayList<>()).add(task);
        }

        List<WorkloadEntryDto> result = new ArrayList<>();
        // 팀원 업무 편중도 화면이므로 심사자는 제외한다(심사자는 업무를 배정받지 않는 평가자).
        List<ProjectMember> members = projectMemberRepository.findAllByProjectId(projectId).stream()
            .filter(member -> member.getRole() != ProjectRole.REVIEWER)
            .toList();
        for (ProjectMember member : members) {
            Long userId = member.getUserId();
            result.add(toWorkloadEntry(userId, byAssignee.remove(userId)));
        }
        for (Map.Entry<Long, List<Task>> entry : byAssignee.entrySet()) {
            result.add(toWorkloadEntry(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    private WorkloadEntryDto toWorkloadEntry(Long assigneeId, List<Task> assigneeTasks) {
        List<Task> tasks = assigneeTasks == null ? List.of() : assigneeTasks;
        long doneCount = tasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long todoCount = tasks.stream().filter(t -> "todo".equals(t.getStatus())).count();
        long inProgressCount = tasks.stream().filter(t -> STATUS_INPROGRESS.equals(t.getStatus())).count();
        long blockedCount = tasks.stream().filter(t -> STATUS_BLOCKED.equals(t.getStatus())).count();
        return new WorkloadEntryDto(
            String.valueOf(assigneeId),
            resolveUserName(assigneeId),
            tasks.size(),
            doneCount,
            todoCount,
            inProgressCount,
            blockedCount
        );
    }

    private List<MilestoneProgressDto> buildMilestoneProgress(Long projectId, List<Task> tasks) {
        Map<Long, List<Task>> tasksByMilestone = new LinkedHashMap<>();
        for (Task task : tasks) {
            if (task.getMilestoneId() == null) {
                continue;
            }
            tasksByMilestone.computeIfAbsent(task.getMilestoneId(), k -> new ArrayList<>()).add(task);
        }

        return milestoneRepository.findByProjectIdOrderByDueDateAsc(projectId).stream()
            .map(m -> toMilestoneProgressDto(m, tasksByMilestone.getOrDefault(m.getId(), List.of())))
            .toList();
    }

    private MilestoneProgressDto toMilestoneProgressDto(Milestone milestone, List<Task> linkedTasks) {
        long taskCount = linkedTasks.size();
        long doneCount = linkedTasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long progressPercent = taskCount == 0 ? 0 : Math.round(doneCount * 100.0 / taskCount);

        String status;
        if (taskCount > 0 && doneCount == taskCount) {
            status = STATUS_DONE;
        } else if (doneCount > 0 || linkedTasks.stream().anyMatch(t -> STATUS_INPROGRESS.equals(t.getStatus()))) {
            status = STATUS_INPROGRESS;
        } else {
            status = "todo";
        }

        return new MilestoneProgressDto(
            String.valueOf(milestone.getId()),
            milestone.getTitle(),
            milestone.getStartDate() == null ? null : milestone.getStartDate().toString(),
            milestone.getDueDate() == null ? null : milestone.getDueDate().toString(),
            status,
            taskCount,
            doneCount,
            progressPercent
        );
    }

    private List<CategoryProgressDto> buildCategoryBreakdown(List<Task> tasks) {
        Map<String, List<Task>> byCategory = new LinkedHashMap<>();
        for (Task task : tasks) {
            byCategory.computeIfAbsent(task.getCategory(), k -> new ArrayList<>()).add(task);
        }

        List<CategoryProgressDto> result = new ArrayList<>();
        for (Map.Entry<String, List<Task>> entry : byCategory.entrySet()) {
            long doneCount = entry.getValue().stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
            result.add(new CategoryProgressDto(entry.getKey(), entry.getValue().size(), doneCount));
        }
        return result;
    }

    /** target_id별로 created_at이 가장 최신인 예측 한 건만 남긴다. */
    private List<MlPrediction> latestPredictionsByTarget(Long projectId) {
        List<MlPrediction> ordered = mlPredictionRepository
            .findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc(
                projectId, TARGET_TYPE_TASK, MODEL_TYPE_DELAY_RISK
            );

        Map<Long, MlPrediction> latestByTarget = new LinkedHashMap<>();
        for (MlPrediction prediction : ordered) {
            latestByTarget.putIfAbsent(prediction.getTargetId(), prediction);
        }
        return new ArrayList<>(latestByTarget.values());
    }

    /** getMyDelayRisks 전용 — task가 없거나 담당자가 userId와 다르면 걸러낸다. */
    private DelayRiskDto toDelayRiskDtoForAssignee(MlPrediction prediction, Task task, Long userId) {
        if (task == null || !userId.equals(task.getAssigneeId())) {
            return null;
        }
        return toDelayRiskDto(prediction, task);
    }

    private DelayRiskDto toDelayRiskDto(MlPrediction prediction, Task task) {
        if (task == null) {
            // 예측 이후 업무가 삭제된 경우 등 - 더 이상 존재하지 않는 업무는 화면에 표시하지 않는다.
            return null;
        }
        Double score = prediction.getScore() == null ? null : prediction.getScore().doubleValue();
        return new DelayRiskDto(
            String.valueOf(task.getId()),
            task.getTitle(),
            resolveUserName(task.getAssigneeId()),
            task.getStatus(),
            task.getDueDate() == null ? null : task.getDueDate().toString(),
            prediction.getResult(),
            score,
            prediction.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(prediction.getCreatedAt())
        );
    }

    private ActivityItemDto toActivityItemDto(Activity activity) {
        return new ActivityItemDto(
            String.valueOf(activity.getId()),
            activity.getType(),
            resolveUserName(activity.getActorId()),
            activity.getMessage(),
            activity.getTargetId() == null ? null : String.valueOf(activity.getTargetId()),
            activity.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(activity.getCreatedAt())
        );
    }

    private DashboardTaskDto toDashboardTaskDto(Task task) {
        return new DashboardTaskDto(
            String.valueOf(task.getId()),
            task.getTitle(),
            task.getCategory(),
            task.getStatus(),
            task.getAssigneeId() == null ? null : String.valueOf(task.getAssigneeId()),
            resolveUserName(task.getAssigneeId()),
            task.getDueDate() == null ? null : task.getDueDate().toString(),
            task.getPriority(),
            task.getDescription(),
            task.getSourceType(),
            task.getPosition(),
            task.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(task.getCreatedAt()),
            task.getUpdatedAt() == null ? null : UtcTimeFormat.toIsoUtc(task.getUpdatedAt())
        );
    }

    private String resolveUserName(Long userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).map(User::getName).orElse(null);
    }
}
