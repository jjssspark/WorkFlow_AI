package com.workflowai.roadmap;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.dashboard.entity.Milestone;
import com.workflowai.dashboard.repository.MilestoneRepository;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectSchedulePolicy;
import com.workflowai.security.CurrentUser;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoadmapService {
    private final DemoDataService demoDataService;
    private final ProjectRepository projectRepository;
    private final MilestoneRepository milestoneRepository;
    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final ActivityService activityService;

    public RoadmapService(
        DemoDataService demoDataService,
        ProjectRepository projectRepository,
        MilestoneRepository milestoneRepository,
        TaskRepository taskRepository,
        UserRepository userRepository,
        ActivityService activityService
    ) {
        this.demoDataService = demoDataService;
        this.projectRepository = projectRepository;
        this.milestoneRepository = milestoneRepository;
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.activityService = activityService;
    }

    @Transactional(readOnly = true)
    public RoadmapResponse getRoadmap(String projectIdParam) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Project project = projectRepository.findById(projectId)
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다."));
        List<Task> tasks = taskRepository.findByProjectIdOrderByStatusAscPositionAsc(projectId);
        Map<Long, List<Task>> tasksByMilestone = new LinkedHashMap<>();
        List<Task> unassigned = new ArrayList<>();
        for (Task task : tasks) {
            if (task.getMilestoneId() == null) {
                unassigned.add(task);
            } else {
                tasksByMilestone.computeIfAbsent(task.getMilestoneId(), ignored -> new ArrayList<>()).add(task);
            }
        }

        List<RoadmapMilestoneDto> milestones = milestoneRepository.findByProjectIdOrderByDueDateAsc(projectId).stream()
            .sorted(Comparator.comparing(Milestone::getStartDate, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(Milestone::getDueDate, Comparator.nullsLast(Comparator.naturalOrder())))
            .map(milestone -> toMilestoneDto(milestone, tasksByMilestone.getOrDefault(milestone.getId(), List.of())))
            .toList();

        return new RoadmapResponse(
            new RoadmapProjectDto(
                String.valueOf(project.getId()),
                project.getTitle(),
                date(project.getStartDate()),
                date(project.getDeadline())
            ),
            milestones,
            unassigned.stream().map(this::toTaskDto).toList()
        );
    }

    @Transactional
    public RoadmapMilestoneDto createMilestone(String projectIdParam, RoadmapMilestoneRequest request) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Project project = requireProject(projectId);
        String title = requireTitle(request.title(), "마일스톤 이름은 필수입니다.");
        LocalDate startDate = parseDate(request.startDate(), "startDate");
        LocalDate dueDate = parseDate(request.dueDate(), "dueDate");
        validateRange(startDate, dueDate);
        ProjectSchedulePolicy.validate(project, startDate, dueDate, "마일스톤");
        Milestone milestone = milestoneRepository.save(new Milestone(projectId, title, startDate, dueDate));
        return toMilestoneDto(milestone, List.of());
    }

    @Transactional
    public RoadmapMilestoneDto updateMilestone(
        String projectIdParam,
        Long milestoneId,
        RoadmapMilestoneRequest request
    ) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Project project = requireProject(projectId);
        Milestone milestone = requireMilestone(projectId, milestoneId);
        String title = requireTitle(request.title(), "마일스톤 이름은 필수입니다.");
        LocalDate startDate = parseDate(request.startDate(), "startDate");
        LocalDate dueDate = parseDate(request.dueDate(), "dueDate");
        validateRange(startDate, dueDate);
        ProjectSchedulePolicy.validate(project, startDate, dueDate, "마일스톤");
        milestone.update(title, startDate, dueDate);
        milestoneRepository.save(milestone);
        List<Task> linked = taskRepository.findByProjectIdOrderByStatusAscPositionAsc(projectId).stream()
            .filter(task -> milestoneId.equals(task.getMilestoneId()))
            .toList();
        return toMilestoneDto(milestone, linked);
    }

    @Transactional
    public void deleteMilestone(String projectIdParam, Long milestoneId) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Milestone milestone = requireMilestone(projectId, milestoneId);
        taskRepository.clearMilestoneId(projectId, milestoneId);
        milestoneRepository.delete(milestone);
    }

    @Transactional
    public RoadmapTaskDto createTask(
        String projectIdParam,
        Long milestoneId,
        RoadmapTaskCreateRequest request
    ) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Project project = requireProject(projectId);
        Milestone milestone = requireMilestone(projectId, milestoneId);
        String title = requireTitle(request.title(), "업무 제목은 필수입니다.");
        LocalDate startDate = request.startDate() == null || request.startDate().isBlank()
            ? defaultTaskStart(milestone) : parseDate(request.startDate(), "startDate");
        LocalDate dueDate = request.dueDate() == null || request.dueDate().isBlank()
            ? milestone.getDueDate() : parseDate(request.dueDate(), "dueDate");
        validateRange(startDate, dueDate);
        ProjectSchedulePolicy.validate(project, startDate, dueDate, "업무");
        String status = "todo";
        Task task = taskRepository.save(new Task(
            projectId,
            milestoneId,
            title,
            defaultString(request.category(), "other"),
            status,
            demoDataService.resolveUserId(request.assigneeId()),
            startDate,
            dueDate,
            defaultString(request.priority(), "medium"),
            null,
            "ROADMAP",
            null,
            CurrentUser.id(),
            nextAppendPosition(projectId, status)
        ));
        activityService.record(projectId, CurrentUser.id(), "TASK_CREATED", task.getId(),
            "'" + task.getTitle() + "' 업무를 '" + milestone.getTitle() + "' 단계에 추가했습니다.");
        return toTaskDto(task);
    }

    @Transactional
    public RoadmapTaskDto moveTask(String projectIdParam, Long taskId, TaskMilestoneUpdateRequest request) {
        Long projectId = demoDataService.resolveProjectId(projectIdParam);
        Task task = taskRepository.findById(taskId)
            .filter(found -> found.getProjectId().equals(projectId))
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        if (request.milestoneId() != null) {
            requireMilestone(projectId, request.milestoneId());
        }
        task.moveToMilestone(request.milestoneId());
        taskRepository.save(task);
        return toTaskDto(task);
    }

    private RoadmapMilestoneDto toMilestoneDto(Milestone milestone, List<Task> tasks) {
        long done = tasks.stream().filter(task -> "done".equals(task.getStatus())).count();
        long progress = tasks.isEmpty() ? 0 : Math.round(done * 100.0 / tasks.size());
        return new RoadmapMilestoneDto(
            String.valueOf(milestone.getId()),
            milestone.getTitle(),
            date(milestone.getStartDate()),
            date(milestone.getDueDate()),
            tasks.size(),
            done,
            progress,
            tasks.stream()
                .sorted(Comparator.comparingDouble(Task::getPosition))
                .map(this::toTaskDto)
                .toList()
        );
    }

    private RoadmapTaskDto toTaskDto(Task task) {
        return new RoadmapTaskDto(
            String.valueOf(task.getId()),
            task.getMilestoneId() == null ? null : String.valueOf(task.getMilestoneId()),
            task.getTitle(),
            task.getCategory(),
            task.getStatus(),
            task.getAssigneeId() == null ? null : String.valueOf(task.getAssigneeId()),
            userName(task.getAssigneeId()),
            date(task.getStartDate()),
            date(task.getDueDate()),
            task.getPriority(),
            task.getDescription(),
            task.getPosition()
        );
    }

    private Milestone requireMilestone(Long projectId, Long milestoneId) {
        return milestoneRepository.findById(milestoneId)
            .filter(milestone -> milestone.getProjectId().equals(projectId))
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "MILESTONE_NOT_FOUND", "마일스톤을 찾을 수 없습니다."));
    }

    private Project requireProject(Long projectId) {
        return projectRepository.findById(projectId)
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다."));
    }

    private double nextAppendPosition(Long projectId, String status) {
        return taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(projectId, status)
            .map(task -> task.getPosition() + 1)
            .orElse(0.0);
    }

    private String userName(Long userId) {
        return userId == null ? null : userRepository.findById(userId).map(User::getName).orElse(null);
    }

    private LocalDate defaultTaskStart(Milestone milestone) {
        if (milestone.getStartDate() == null) {
            return null;
        }
        LocalDate today = LocalDate.now();
        LocalDate candidate = today.isAfter(milestone.getStartDate()) ? today : milestone.getStartDate();
        if (milestone.getDueDate() != null && candidate.isAfter(milestone.getDueDate())) {
            return milestone.getDueDate();
        }
        return candidate;
    }

    private static String requireTitle(String title, String message) {
        if (title == null || title.isBlank()) {
            throw error(HttpStatus.BAD_REQUEST, "TITLE_REQUIRED", message);
        }
        if (title.trim().length() > 200) {
            throw error(HttpStatus.BAD_REQUEST, "TITLE_TOO_LONG", "제목은 200자 이하여야 합니다.");
        }
        return title.trim();
    }

    private static LocalDate parseDate(String value, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException e) {
            throw error(HttpStatus.BAD_REQUEST, "INVALID_DATE", field + "는 YYYY-MM-DD 형식이어야 합니다.");
        }
    }

    private static void validateRange(LocalDate startDate, LocalDate dueDate) {
        if (startDate != null && dueDate != null && startDate.isAfter(dueDate)) {
            throw error(HttpStatus.BAD_REQUEST, "INVALID_DATE_RANGE", "시작일은 마감일보다 늦을 수 없습니다.");
        }
    }

    private static String defaultString(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String date(LocalDate value) {
        return value == null ? null : value.toString();
    }

    private static RoadmapException error(HttpStatus status, String code, String message) {
        return new RoadmapException(status, code, message);
    }
}
