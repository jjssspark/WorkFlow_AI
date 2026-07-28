package com.workflowai.reviewer;

import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import com.workflowai.common.UtcTimeFormat;
import com.workflowai.deliverable.DeliverableRepository;
import com.workflowai.github.GithubRecordRepository;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class ReviewerService {
    private static final String TASK_STATUS_DONE = "done";
    private static final String DELIVERABLE_STATUS_FINAL = "final";
    private static final List<String> REVIEWER_ACTIVITY_TYPES = List.of(
        "CONTRIBUTION_SCORE_PUBLISHED", "CONTRIBUTION_SCORE_UNPUBLISHED",
        "GRADE_PUBLISHED", "GRADE_UNPUBLISHED",
        "REVIEW_COMMENT_SAVED",
        "EVALUATION_FINALIZED", "EVALUATION_UNFINALIZED"
    );

    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;
    private final TaskRepository taskRepository;
    private final DeliverableRepository deliverableRepository;
    private final GithubRecordRepository githubRecordRepository;
    private final ActivityRepository activityRepository;

    public ReviewerService(
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        UserRepository userRepository,
        TaskRepository taskRepository,
        DeliverableRepository deliverableRepository,
        GithubRecordRepository githubRecordRepository,
        ActivityRepository activityRepository
    ) {
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.taskRepository = taskRepository;
        this.deliverableRepository = deliverableRepository;
        this.githubRecordRepository = githubRecordRepository;
        this.activityRepository = activityRepository;
    }

    private record TaskProgress(long done, long total) {}

    private record DeliverableProgress(long submitted, long total) {}

    public List<ReviewerProjectSummary> getMyReviewProjects(Long userId) {
        List<Long> projectIds = projectMemberRepository.findAllByUserId(userId).stream()
            .filter(pm -> pm.getRole() == ProjectRole.REVIEWER)
            .map(ProjectMember::getProjectId)
            .toList();
        if (projectIds.isEmpty()) {
            return List.of();
        }

        Map<Long, Project> projectsById = projectRepository.findAllById(projectIds).stream()
            .collect(Collectors.toMap(Project::getId, project -> project));

        Map<Long, String> leaderNameByProjectId = resolveLeaderNames(projectIds);

        Map<Long, Long> memberCountByProjectId = new HashMap<>();
        projectMemberRepository.countMembersByProjectIds(projectIds)
            .forEach(v -> memberCountByProjectId.put(v.getProjectId(), v.getMemberCount()));

        Map<Long, TaskProgress> taskProgressByProjectId = new HashMap<>();
        taskRepository.summarizeProgressByProjectIds(projectIds, TASK_STATUS_DONE)
            .forEach(v -> taskProgressByProjectId.put(v.getProjectId(), new TaskProgress(v.getDoneCount(), v.getTotalCount())));

        Map<Long, DeliverableProgress> deliverableByProjectId = new HashMap<>();
        deliverableRepository.summarizeByProjectIds(projectIds, DELIVERABLE_STATUS_FINAL)
            .forEach(v -> deliverableByProjectId.put(v.getProjectId(), new DeliverableProgress(v.getSubmittedCount(), v.getTotalCount())));

        Set<Long> githubConnectedProjectIds = new HashSet<>(githubRecordRepository.findDistinctProjectIdsIn(projectIds));

        return projectIds.stream()
            .map(projectId -> toSummary(
                projectsById.get(projectId),
                leaderNameByProjectId.get(projectId),
                memberCountByProjectId.getOrDefault(projectId, 0L).intValue(),
                taskProgressByProjectId.get(projectId),
                deliverableByProjectId.get(projectId),
                githubConnectedProjectIds.contains(projectId)
            ))
            .toList();
    }

    private Map<Long, String> resolveLeaderNames(List<Long> projectIds) {
        Map<Long, Long> leaderUserIdByProjectId = projectMemberRepository
            .findAllByProjectIdInAndRole(projectIds, ProjectRole.LEADER).stream()
            .collect(Collectors.toMap(ProjectMember::getProjectId, ProjectMember::getUserId));

        Map<Long, User> usersById = userRepository.findAllById(List.copyOf(leaderUserIdByProjectId.values())).stream()
            .collect(Collectors.toMap(User::getId, user -> user));

        Map<Long, String> result = new HashMap<>();
        leaderUserIdByProjectId.forEach((projectId, leaderUserId) -> {
            User leader = usersById.get(leaderUserId);
            result.put(projectId, leader != null ? leader.getName() : null);
        });
        return result;
    }

    private ReviewerProjectSummary toSummary(
        Project project,
        String leaderName,
        int memberCount,
        TaskProgress taskProgress,
        DeliverableProgress deliverableProgress,
        boolean githubConnected
    ) {
        long done = taskProgress == null ? 0 : taskProgress.done();
        long total = taskProgress == null ? 0 : taskProgress.total();
        int progressPercent = total == 0 ? 0 : (int) Math.round(done * 100.0 / total);
        long submitted = deliverableProgress == null ? 0 : deliverableProgress.submitted();
        long deliverablesTotal = deliverableProgress == null ? 0 : deliverableProgress.total();

        return new ReviewerProjectSummary(
            project.getId(),
            project.getTitle(),
            project.getType(),
            leaderName,
            memberCount,
            progressPercent,
            project.getEvalStatus().toJson(),
            (int) submitted,
            (int) deliverablesTotal,
            githubConnected
        );
    }

    /** 심사자 홈 "최근 심사 활동" 위젯 — 로그인한 심사자 본인이 남긴 활동만 최신순 10건. */
    public List<ReviewerActivityDto> getMyRecentActivities(Long actorId) {
        List<Activity> activities = activityRepository
            .findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(actorId, REVIEWER_ACTIVITY_TYPES);
        if (activities.isEmpty()) {
            return List.of();
        }

        Map<Long, String> projectTitleById = new HashMap<>();
        projectRepository.findAllById(activities.stream().map(Activity::getProjectId).distinct().toList())
            .forEach(project -> projectTitleById.put(project.getId(), project.getTitle()));

        List<ReviewerActivityDto> result = new ArrayList<>();
        for (Activity activity : activities) {
            result.add(new ReviewerActivityDto(
                String.valueOf(activity.getId()),
                projectTitleById.getOrDefault(activity.getProjectId(), "프로젝트"),
                activity.getMessage(),
                UtcTimeFormat.toIsoUtc(activity.getCreatedAt())
            ));
        }
        return result;
    }

    /** 심사자 홈 배정 프로젝트 목록의 최근 접속순 정렬 — 로그인한 심사자 본인의 프로젝트별 마지막 접속 시각. */
    public List<ProjectLastAccessDto> getMyLastAccess(Long actorId) {
        return activityRepository.findLastProjectAccessByActorId(actorId).stream()
            .map(view -> new ProjectLastAccessDto(view.getProjectId(), UtcTimeFormat.toIsoUtc(view.getLastAccessedAt())))
            .toList();
    }
}
