package com.workflowai.task;

import com.workflowai.common.ApiResponse;
import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.CurrentUser;
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
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// DONE: @projectAccess.isMember(#projectId)로 프로젝트 멤버십 검사 적용 완료 (2026-07-18).
@Tag(name = "업무 코멘트", description = "업무에 대한 코멘트 조회/작성/수정/삭제 API")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/tasks/{taskId}/comments")
public class TaskCommentController {
    private final TaskCommentRepository taskCommentRepository;
    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final DemoDataService demoDataService;
    private final ProjectMemberRepository projectMemberRepository;
    private final NotificationService notificationService;

    public TaskCommentController(
        TaskCommentRepository taskCommentRepository,
        TaskRepository taskRepository,
        UserRepository userRepository,
        DemoDataService demoDataService,
        ProjectMemberRepository projectMemberRepository,
        NotificationService notificationService
    ) {
        this.taskCommentRepository = taskCommentRepository;
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.demoDataService = demoDataService;
        this.projectMemberRepository = projectMemberRepository;
        this.notificationService = notificationService;
    }

    private Task resolveTaskOrNull(String projectId, Long taskId) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return null;
        }
        return task;
    }

    private static String normalizeType(String type) {
        return "FEEDBACK".equals(type) ? "FEEDBACK" : "COMMENT";
    }

    private boolean isLeader(Long projectId, Long userId) {
        return projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
            .map(member -> member.getRole() == ProjectRole.LEADER)
            .orElse(false);
    }

    // 데모 유저는 provider="demo"이고 providerId가 곧 프론트가 쓰는 mock id("1"~"4")다.
    private TaskCommentDto toDto(TaskComment comment, Map<Long, User> userCache) {
        User author = userCache.get(comment.getAuthorId());
        String authorName = author != null ? author.getName() : "알 수 없음";
        String authorMockId = author != null ? author.getProviderId() : null;
        return TaskCommentDto.from(comment, authorName, authorMockId);
    }

    @Operation(summary = "코멘트 조회", description = "업무에 등록된 코멘트를 작성 순서대로 조회합니다.")
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<List<TaskCommentDto>>> getComments(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        if (resolveTaskOrNull(projectId, taskId) == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        List<TaskComment> comments = taskCommentRepository.findByTaskIdOrderByCreatedAtAsc(taskId);
        Map<Long, User> userCache = userRepository.findAllById(
            comments.stream().map(TaskComment::getAuthorId).distinct().toList()
        ).stream().collect(Collectors.toMap(User::getId, u -> u));
        List<TaskCommentDto> dtos = comments.stream().map(c -> toDto(c, userCache)).toList();
        return ResponseEntity.ok(ApiResponse.ok(dtos));
    }

    @Operation(summary = "코멘트 작성", description = "업무에 새 코멘트를 남깁니다. type=FEEDBACK은 팀장만 작성할 수 있습니다.")
    @PostMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    @Transactional
    public ResponseEntity<ApiResponse<TaskCommentDto>> createComment(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody TaskCommentCreateRequest request
    ) {
        if (request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_REQUIRED", "코멘트 내용은 필수입니다."));
        }
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long authorDbId = CurrentUser.id();
        String type = normalizeType(request.type());
        if ("FEEDBACK".equals(type) && !isLeader(task.getProjectId(), authorDbId)) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_LEADER", "팀장만 피드백을 남길 수 있습니다."));
        }
        TaskComment saved = taskCommentRepository.save(new TaskComment(taskId, authorDbId, request.content(), type));
        User author = userRepository.findById(authorDbId).orElse(null);
        String authorName = author != null ? author.getName() : "알 수 없음";
        String authorMockId = author != null ? author.getProviderId() : null;
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(authorDbId)) {
            boolean isFeedback = "FEEDBACK".equals(type);
            String verb = isFeedback ? "피드백을" : "코멘트를";
            String noun = isFeedback ? "피드백이" : "코멘트가";
            notificationService.notify(
                task.getAssigneeId(), "TASK_COMMENT", "새 " + noun + " 달렸습니다.",
                "'" + authorName + "'님이 '" + task.getTitle() + "' 업무에 " + verb + " 남겼습니다.", "task", task.getId()
            );
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskCommentDto.from(saved, authorName, authorMockId)));
    }

    @Operation(summary = "코멘트 수정", description = "코멘트 내용을 수정합니다.")
    @PatchMapping("/{commentId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<TaskCommentDto>> updateComment(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @Parameter(description = "코멘트 ID") @PathVariable Long commentId,
        @RequestBody TaskCommentUpdateRequest request
    ) {
        if (request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_REQUIRED", "코멘트 내용은 비워둘 수 없습니다."));
        }
        if (resolveTaskOrNull(projectId, taskId) == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        TaskComment comment = taskCommentRepository.findById(commentId).orElse(null);
        if (comment == null || !comment.getTaskId().equals(taskId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("COMMENT_NOT_FOUND", "코멘트를 찾을 수 없습니다."));
        }
        comment.setContent(request.content());
        taskCommentRepository.save(comment);
        User author = userRepository.findById(comment.getAuthorId()).orElse(null);
        String authorName = author != null ? author.getName() : "알 수 없음";
        String authorMockId = author != null ? author.getProviderId() : null;
        return ResponseEntity.ok(ApiResponse.ok(TaskCommentDto.from(comment, authorName, authorMockId)));
    }

    @Operation(summary = "코멘트 삭제", description = "코멘트를 삭제합니다.")
    @DeleteMapping("/{commentId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<Void>> deleteComment(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @Parameter(description = "코멘트 ID") @PathVariable Long commentId
    ) {
        if (resolveTaskOrNull(projectId, taskId) == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        TaskComment comment = taskCommentRepository.findById(commentId).orElse(null);
        if (comment == null || !comment.getTaskId().equals(taskId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("COMMENT_NOT_FOUND", "코멘트를 찾을 수 없습니다."));
        }
        taskCommentRepository.delete(comment);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
