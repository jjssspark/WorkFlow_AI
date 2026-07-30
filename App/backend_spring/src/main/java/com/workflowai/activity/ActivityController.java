package com.workflowai.activity;

import com.workflowai.common.ApiResponse;
import com.workflowai.common.DemoDataService;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// DONE: @projectAccess.isMember(#projectId)로 프로젝트 멤버십 검사 적용 완료 (2026-07-18).
@Tag(name = "업무 활동 로그", description = "업무에 대한 실제 변경 이력 조회 API")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/tasks/{taskId}/activities")
public class ActivityController {
    private final ActivityRepository activityRepository;
    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final DemoDataService demoDataService;

    public ActivityController(
        ActivityRepository activityRepository,
        TaskRepository taskRepository,
        UserRepository userRepository,
        DemoDataService demoDataService
    ) {
        this.activityRepository = activityRepository;
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.demoDataService = demoDataService;
    }

    @Operation(
        summary = "업무 활동 로그 조회",
        description = "이 업무에서 실제로 일어난 변경(상태변경/생성/수정/담당자변경/체크리스트/삭제)만 최신순으로 조회합니다. 더미 기록은 없습니다."
    )
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<List<ActivityDto>>> getActivity(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }

        List<Activity> activities = activityRepository
            .findByProjectIdAndTargetIdAndTypeNotInOrderByCreatedAtDesc(
                projectDbId, taskId, ActivityTypes.NON_TASK_TARGET
            );
        Map<Long, User> userCache = userRepository.findAllById(
            activities.stream().map(Activity::getActorId).distinct().toList()
        ).stream().collect(Collectors.toMap(User::getId, u -> u));

        List<ActivityDto> dtos = activities.stream()
            .map(a -> ActivityDto.from(a, userCache.containsKey(a.getActorId()) ? userCache.get(a.getActorId()).getName() : "알 수 없음"))
            .toList();
        return ResponseEntity.ok(ApiResponse.ok(dtos));
    }
}
