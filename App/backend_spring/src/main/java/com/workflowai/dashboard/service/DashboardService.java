package com.workflowai.dashboard.service;

import com.workflowai.common.DemoDataService;
import com.workflowai.common.UtcTimeFormat;
import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import com.workflowai.notification.NotificationService;
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
import com.workflowai.dashboard.DTO.DashboardAiJobResponse;
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
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {

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
    private final FastApiWorkloadScoreClient fastApiWorkloadScoreClient;
    private final ProjectRepository projectRepository;
    private final NotificationService notificationService;
    private final DashboardAiJobPublisher dashboardAiJobPublisher;
    private final DashboardWorkloadScoreCache workloadScoreCache;

    public DashboardService(
        TaskRepository taskRepository,
        MilestoneRepository milestoneRepository,
        ActivityRepository activityRepository,
        MlPredictionRepository mlPredictionRepository,
        UserRepository userRepository,
        ProjectMemberRepository projectMemberRepository,
        DemoDataService demoDataService,
        FastApiWorkloadScoreClient fastApiWorkloadScoreClient,
        ProjectRepository projectRepository,
        NotificationService notificationService,
        DashboardAiJobPublisher dashboardAiJobPublisher,
        DashboardWorkloadScoreCache workloadScoreCache
    ) {
        this.taskRepository = taskRepository;
        this.milestoneRepository = milestoneRepository;
        this.activityRepository = activityRepository;
        this.mlPredictionRepository = mlPredictionRepository;
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.demoDataService = demoDataService;
        this.fastApiWorkloadScoreClient = fastApiWorkloadScoreClient;
        this.projectRepository = projectRepository;
        this.notificationService = notificationService;
        this.dashboardAiJobPublisher = dashboardAiJobPublisher;
        this.workloadScoreCache = workloadScoreCache;
    }

    @Transactional(readOnly = true)
    public DashboardSummaryResponse getSummary(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        long total = tasks.size();
        long done = tasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long blocked = tasks.stream().filter(t -> STATUS_BLOCKED.equals(t.getStatus())).count();
        long inProgress = tasks.stream().filter(t -> STATUS_INPROGRESS.equals(t.getStatus())).count();
        long progressPercent = total == 0 ? 0 : Math.round(done * 100.0 / total);

        List<Activity> recentActivityRows = activityRepository.findTop10ByProjectIdOrderByCreatedAtDesc(projectId);
        // 팀원 업무 편중도(workload) 화면이므로 심사자는 제외한다(심사자는 업무를 배정받지 않는 평가자).
        List<ProjectMember> members = projectMemberRepository.findAllByProjectId(projectId).stream()
            .filter(member -> member.getRole() != ProjectRole.REVIEWER)
            .toList();

        // 업무마다/활동마다 담당자 이름을 각각 조회하면(N+1) Supabase 왕복이 업무·활동 개수만큼
        // 늘어나 대시보드 로딩이 크게 느려진다(2026-07-27 실측) - 필요한 user id를 모아 한 번에 조회한다.
        Set<Long> userIds = new java.util.HashSet<>();
        tasks.forEach(t -> userIds.add(t.getAssigneeId()));
        recentActivityRows.forEach(a -> userIds.add(a.getActorId()));
        members.forEach(m -> userIds.add(m.getUserId()));
        Map<Long, String> userNames = loadUserNames(userIds);

        List<UpcomingTaskDto> upcoming = tasks.stream()
            .filter(t -> !STATUS_DONE.equals(t.getStatus()))
            .sorted(Comparator.comparing(Task::getDueDate, Comparator.nullsLast(Comparator.naturalOrder())))
            .limit(5)
            .map(t -> new UpcomingTaskDto(
                String.valueOf(t.getId()),
                t.getTitle(),
                t.getStatus(),
                t.getDueDate() == null ? null : t.getDueDate().toString(),
                userNames.get(t.getAssigneeId())
            ))
            .toList();

        List<WorkloadEntryDto> workload = buildWorkload(members, tasks, userNames);

        List<ActivityItemDto> recentActivity = recentActivityRows.stream()
            .map(a -> toActivityItemDto(a, userNames))
            .toList();

        return new DashboardSummaryResponse(total, done, progressPercent, blocked, inProgress, upcoming, workload, recentActivity);
    }

    @Transactional(readOnly = true)
    public List<DashboardTaskDto> getTasks(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByStatusAscPositionAsc(projectId);
        Map<Long, String> userNames = loadUserNames(tasks.stream().map(Task::getAssigneeId).toList());
        return tasks.stream()
            .map(t -> toDashboardTaskDto(t, userNames))
            .toList();
    }

    @Transactional(readOnly = true)
    public List<ActivityItemDto> getActivities(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Activity> activities = activityRepository.findTop50ByProjectIdOrderByCreatedAtDesc(projectId);
        Map<Long, String> userNames = loadUserNames(activities.stream().map(Activity::getActorId).toList());
        return activities.stream()
            .map(a -> toActivityItemDto(a, userNames))
            .toList();
    }

    @Transactional(readOnly = true)
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
        Map<Long, String> userNames = loadUserNames(tasks.stream().map(Task::getAssigneeId).toList());

        List<DelayRiskDto> delayRisks = latestPredictions.stream()
            .filter(p -> !RISK_RESULT_NORMAL.equals(p.getResult()))
            .map(p -> toDelayRiskDto(p, tasksById.get(p.getTargetId()), userNames))
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
    @Transactional(readOnly = true)
    public List<DelayRiskDto> getMyDelayRisks(String projectIdParam, Long userId) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        List<Task> tasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        Map<Long, Task> tasksById = new LinkedHashMap<>();
        tasks.forEach(t -> tasksById.put(t.getId(), t));
        Map<Long, String> userNames = loadUserNames(List.of(userId));

        return latestPredictionsByTarget(projectId).stream()
            .filter(p -> !RISK_RESULT_NORMAL.equals(p.getResult()))
            .map(p -> toDelayRiskDtoForAssignee(p, tasksById.get(p.getTargetId()), userId, userNames))
            .filter(java.util.Objects::nonNull)
            .toList();
    }

    /** 마일스톤을 새로 만들고, 팀장/팀원 전체(생성자 포함)에게 알린 뒤, 진행률 0%인 MilestoneProgressDto로 반환한다. */
    public MilestoneProgressDto createMilestone(String projectIdParam, String title, java.time.LocalDate startDate, java.time.LocalDate dueDate) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Milestone saved = milestoneRepository.save(new Milestone(projectId, title, startDate, dueDate));

        String content = "'" + saved.getTitle() + "' 마일스톤이 추가되었습니다.";
        projectMemberRepository.findAllByProjectId(projectId).stream()
            .map(ProjectMember::getUserId)
            .forEach(memberId -> notificationService.notify(
                memberId, "MILESTONE_CREATED", "마일스톤이 추가되었습니다.", content, "milestone", saved.getId()
            ));

        return toMilestoneProgressDto(saved, List.of());
    }

    /** 마일스톤의 이름/시작일/마감일을 수정하고, 최신 진행률을 담아 MilestoneProgressDto로 반환한다. */
    public MilestoneProgressDto updateMilestone(
        String projectIdParam, Long milestoneId, String title, java.time.LocalDate startDate, java.time.LocalDate dueDate
    ) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Milestone milestone = milestoneRepository.findById(milestoneId)
            .filter(m -> m.getProjectId().equals(projectId))
            .orElseThrow(() -> new IllegalArgumentException("마일스톤을 찾을 수 없습니다."));

        String titleBefore = milestone.getTitle();
        java.time.LocalDate startDateBefore = milestone.getStartDate();
        java.time.LocalDate dueDateBefore = milestone.getDueDate();

        milestone.applyUpdate(title, startDate, dueDate);
        Milestone saved = milestoneRepository.save(milestone);

        List<String> changes = new ArrayList<>();
        if (!Objects.equals(titleBefore, saved.getTitle())) {
            changes.add("이름이 '" + saved.getTitle() + "'(으)로");
        }
        if (!Objects.equals(startDateBefore, saved.getStartDate())) {
            changes.add("시작일이 " + (saved.getStartDate() == null ? "미정" : saved.getStartDate() + "일") + "(으)로");
        }
        if (!Objects.equals(dueDateBefore, saved.getDueDate())) {
            changes.add("마감일이 " + (saved.getDueDate() == null ? "미정" : saved.getDueDate() + "일") + "(으)로");
        }
        if (!changes.isEmpty()) {
            String content = "마일스톤 '" + titleBefore + "'의 " + String.join(", ", changes) + " 변경되었습니다.";
            projectMemberRepository.findAllByProjectId(projectId).stream()
                .map(ProjectMember::getUserId)
                .forEach(memberId -> notificationService.notify(
                    memberId, "MILESTONE_UPDATED", "마일스톤이 수정되었습니다.", content, "milestone", saved.getId()
                ));
        }

        List<Task> linkedTasks = taskRepository.findByProjectIdOrderByCreatedAtDesc(projectId).stream()
            .filter(t -> milestoneId.equals(t.getMilestoneId()))
            .toList();
        return toMilestoneProgressDto(saved, linkedTasks);
    }

    /** 마일스톤 연결 업무를 일정 미정으로 옮긴 뒤 삭제하고, 팀 전체에 알린다. */
    @Transactional
    public void deleteMilestone(String projectIdParam, Long milestoneId) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Milestone milestone = milestoneRepository.findById(milestoneId)
            .filter(m -> m.getProjectId().equals(projectId))
            .orElseThrow(() -> new IllegalArgumentException("마일스톤을 찾을 수 없습니다."));
        String title = milestone.getTitle();
        taskRepository.clearMilestoneId(projectId, milestoneId);
        milestoneRepository.delete(milestone);

        String content = "'" + title + "' 마일스톤이 삭제되었습니다.";
        projectMemberRepository.findAllByProjectId(projectId).stream()
            .map(ProjectMember::getUserId)
            .forEach(memberId -> notificationService.notify(
                memberId, "MILESTONE_DELETED", "마일스톤이 삭제되었습니다.", content, "milestone", null
            ));
    }

    /**
     * 지연 위험도 재분석을 Redis Queue(dashboard-ai-jobs)에 적재하고 즉시 "처리중" 응답을 돌려준다.
     * 실제 FastAPI 재예측·ml_predictions 갱신은 DashboardAiQueueWorker가 비동기로 수행하며,
     * 완료되면 팀원에게 SSE 알림이 간다. 프론트는 반환된 jobId로 getDelayRiskRefreshStatus를 폴링해
     * 완료 시점을 파악한 뒤 getProgressDetail로 최신 결과를 다시 불러온다.
     */
    public DashboardAiJobResponse enqueueDelayRiskRefresh(String projectIdParam, Long requestedBy) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        String jobId = dashboardAiJobPublisher.enqueue(projectId, DashboardAiJobType.DELAY_RISK, requestedBy);
        return new DashboardAiJobResponse(jobId, projectIdParam, DashboardAiJobType.DELAY_RISK.name(), "PROCESSING");
    }

    public DashboardAiJobResponse getDelayRiskRefreshStatus(String projectIdParam, String jobId) {
        return jobStatus(projectIdParam, jobId, DashboardAiJobType.DELAY_RISK);
    }

    /** 업무 편중 점수 계산을 Redis Queue에 적재한다. enqueueDelayRiskRefresh와 동일한 흐름이다. */
    public DashboardAiJobResponse enqueueWorkloadScoreRefresh(String projectIdParam, Long requestedBy) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        String jobId = dashboardAiJobPublisher.enqueue(projectId, DashboardAiJobType.WORKLOAD_SCORE, requestedBy);
        return new DashboardAiJobResponse(jobId, projectIdParam, DashboardAiJobType.WORKLOAD_SCORE.name(), "PROCESSING");
    }

    public DashboardAiJobResponse getWorkloadScoreRefreshStatus(String projectIdParam, String jobId) {
        return jobStatus(projectIdParam, jobId, DashboardAiJobType.WORKLOAD_SCORE);
    }

    private DashboardAiJobResponse jobStatus(String projectIdParam, String jobId, DashboardAiJobType jobType) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        boolean active = dashboardAiJobPublisher.isJobActive(projectId, jobType, jobId);
        return new DashboardAiJobResponse(jobId, projectIdParam, jobType.name(), active ? "PROCESSING" : "DONE");
    }

    /** ml_workload_score(FastAPI)가 계산한 팀원별 업무 편중(과부하/저활동) 점수를 가져온다.
     * Redis에 캐시된 마지막 계산 결과가 있으면 그것을 바로 돌려주고(대시보드 로딩마다 FastAPI를
     * 다시 호출하지 않는다), 캐시가 아직 없을 때만(예: 이 프로젝트에서 한 번도 재분석하지 않은 경우)
     * 라이브로 계산해 캐시를 채운다. */
    public WorkloadScoreResponseDto getWorkloadScore(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        return workloadScoreCache.get(projectId).orElseGet(() -> {
            WorkloadScoreResponseDto live = fastApiWorkloadScoreClient.fetch(projectId);
            workloadScoreCache.put(projectId, live);
            return live;
        });
    }

    private List<WorkloadEntryDto> buildWorkload(List<ProjectMember> members, List<Task> tasks, Map<Long, String> userNames) {
        Map<Long, List<Task>> byAssignee = new LinkedHashMap<>();
        for (Task task : tasks) {
            if (task.getAssigneeId() == null) {
                continue;
            }
            byAssignee.computeIfAbsent(task.getAssigneeId(), k -> new ArrayList<>()).add(task);
        }

        List<WorkloadEntryDto> result = new ArrayList<>();
        for (ProjectMember member : members) {
            Long userId = member.getUserId();
            result.add(toWorkloadEntry(userId, byAssignee.remove(userId), userNames));
        }
        for (Map.Entry<Long, List<Task>> entry : byAssignee.entrySet()) {
            result.add(toWorkloadEntry(entry.getKey(), entry.getValue(), userNames));
        }
        return result;
    }

    private WorkloadEntryDto toWorkloadEntry(Long assigneeId, List<Task> assigneeTasks, Map<Long, String> userNames) {
        List<Task> tasks = assigneeTasks == null ? List.of() : assigneeTasks;
        long doneCount = tasks.stream().filter(t -> STATUS_DONE.equals(t.getStatus())).count();
        long todoCount = tasks.stream().filter(t -> "todo".equals(t.getStatus())).count();
        long inProgressCount = tasks.stream().filter(t -> STATUS_INPROGRESS.equals(t.getStatus())).count();
        long blockedCount = tasks.stream().filter(t -> STATUS_BLOCKED.equals(t.getStatus())).count();
        return new WorkloadEntryDto(
            String.valueOf(assigneeId),
            userNames.get(assigneeId),
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
            progressPercent,
            milestone.getCreatedAt() == null ? null : milestone.getCreatedAt().toString(),
            linkedTasks.stream().map(t -> String.valueOf(t.getId())).toList()
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
    private DelayRiskDto toDelayRiskDtoForAssignee(MlPrediction prediction, Task task, Long userId, Map<Long, String> userNames) {
        if (task == null || !userId.equals(task.getAssigneeId())) {
            return null;
        }
        return toDelayRiskDto(prediction, task, userNames);
    }

    private DelayRiskDto toDelayRiskDto(MlPrediction prediction, Task task, Map<Long, String> userNames) {
        if (task == null) {
            // 예측 이후 업무가 삭제된 경우 등 - 더 이상 존재하지 않는 업무는 화면에 표시하지 않는다.
            return null;
        }
        Double score = prediction.getScore() == null ? null : prediction.getScore().doubleValue();
        return new DelayRiskDto(
            String.valueOf(task.getId()),
            task.getTitle(),
            userNames.get(task.getAssigneeId()),
            task.getStatus(),
            task.getDueDate() == null ? null : task.getDueDate().toString(),
            prediction.getResult(),
            score,
            prediction.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(prediction.getCreatedAt())
        );
    }

    private ActivityItemDto toActivityItemDto(Activity activity, Map<Long, String> userNames) {
        return new ActivityItemDto(
            String.valueOf(activity.getId()),
            activity.getType(),
            activity.getActorId() == null ? null : String.valueOf(activity.getActorId()),
            userNames.get(activity.getActorId()),
            activity.getMessage(),
            activity.getTargetId() == null ? null : String.valueOf(activity.getTargetId()),
            activity.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(activity.getCreatedAt())
        );
    }

    private DashboardTaskDto toDashboardTaskDto(Task task, Map<Long, String> userNames) {
        return new DashboardTaskDto(
            String.valueOf(task.getId()),
            task.getTitle(),
            task.getCategory(),
            task.getStatus(),
            task.getAssigneeId() == null ? null : String.valueOf(task.getAssigneeId()),
            userNames.get(task.getAssigneeId()),
            task.getDueDate() == null ? null : task.getDueDate().toString(),
            task.getDoneDate() == null ? null : task.getDoneDate().toString(),
            task.getPriority(),
            task.getDescription(),
            task.getSourceType(),
            task.getPosition(),
            task.getCreatedAt() == null ? null : UtcTimeFormat.toIsoUtc(task.getCreatedAt()),
            task.getUpdatedAt() == null ? null : UtcTimeFormat.toIsoUtc(task.getUpdatedAt())
        );
    }

    /** 여러 user id의 이름을 한 번의 쿼리로 조회한다(반복 조회로 인한 N+1 방지). */
    private Map<Long, String> loadUserNames(Collection<Long> userIds) {
        List<Long> distinctIds = userIds.stream().filter(Objects::nonNull).distinct().toList();
        if (distinctIds.isEmpty()) {
            return Map.of();
        }
        return userRepository.findAllById(distinctIds).stream()
            .collect(java.util.stream.Collectors.toMap(User::getId, u -> Objects.requireNonNullElse(u.getName(), "")));
    }
}
