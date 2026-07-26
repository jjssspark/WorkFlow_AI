package com.workflowai.task;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.ApiResponse;
import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.project.ProjectSchedulePolicy;
import com.workflowai.rag.RagIngestService;
import com.workflowai.security.CurrentUser;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "업무", description = "프로젝트 업무(Task) 조회/생성/수정 API")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/tasks")
public class TaskController {
    private static final Logger log = LoggerFactory.getLogger(TaskController.class);
    private static final Map<String, String> STATUS_LABELS = Map.of(
        "todo", "할 일",
        "inprogress", "진행 중",
        "blocked", "보류/블로커",
        "done", "완료"
    );

    private static final Map<String, String> NUDGE_TITLES = Map.of(
        "START", "업무 시작 알림",
        "PROGRESS", "진행상황 공유 요청",
        "URGENT", "긴급 확인 요청"
    );
    private static final Map<String, String> NUDGE_MESSAGE_TEMPLATES = Map.of(
        "START", "'%s' 업무를 시작해주세요.",
        "PROGRESS", "'%s' 업무의 진행상황을 공유해주세요.",
        "URGENT", "'%s' 업무가 보류 중입니다. 빠른 확인이 필요합니다."
    );

    private final TaskRepository taskRepository;
    private final UserRepository userRepository;
    private final DemoDataService demoDataService;
    private final ActivityService activityService;
    private final NotificationService notificationService;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final RagIngestService ragIngestService;

    public TaskController(
        TaskRepository taskRepository,
        UserRepository userRepository,
        DemoDataService demoDataService,
        ActivityService activityService,
        NotificationService notificationService,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        RagIngestService ragIngestService
    ) {
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
        this.demoDataService = demoDataService;
        this.activityService = activityService;
        this.notificationService = notificationService;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.ragIngestService = ragIngestService;
    }

    private Long currentActorId() {
        return CurrentUser.id();
    }

    private String userName(Long userId) {
        if (userId == null) return "알 수 없음";
        return userRepository.findById(userId).map(User::getName).orElse("알 수 없음");
    }

    @Operation(
        summary = "프로젝트 업무 목록 조회",
        description = "프로젝트에 등록된 업무(Task)를 최신순으로 조회합니다. 회의록 AI가 등록한 업무와 수동 등록 업무를 모두 포함합니다."
    )
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<TaskListItem>> getTasks(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        List<TaskListItem> tasks = taskRepository.findByProjectIdOrderByStatusAscPositionAsc(projectDbId).stream()
            .map(TaskListItem::from)
            .toList();
        return ApiResponse.ok(tasks);
    }

    /**
     * assigneeId는 프론트에서 실제 사용자 DB id 문자열로 전달된다.
     * 데모 mock id("1"~"5")로 먼저 풀어보는 방식은 실제 사용자 id와 값이 우연히 겹칠 때
     * 엉뚱한 사용자로 배정되는 위험이 있어 쓰지 않는다 — 그대로 Long으로 파싱한다.
     * 형식이 잘못된 값은 호출부에서 NumberFormatException을 잡아 400으로 응답한다.
     */
    private Long resolveAssigneeId(String assigneeIdParam) {
        if (assigneeIdParam == null || assigneeIdParam.isBlank()) return null;
        return Long.parseLong(assigneeIdParam);
    }

    /** 해당 프로젝트+상태 컬럼의 맨 끝에 놓일 position(가장 큰 값 + 1, 비어있으면 0). */
    private double nextAppendPosition(Long projectDbId, String status) {
        return taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(projectDbId, status)
            .map(t -> t.getPosition() + 1)
            .orElse(0.0);
    }

    // DONE: @projectAccess.isMember(#projectId)로 프로젝트 멤버십 검사 적용 완료 (2026-07-18).
    // DONE: assigneeId 실제 유저 id 미해석, currentActorId() mock 고정 문제 수정 (2026-07-22).

    @Operation(
        summary = "업무 생성",
        description = "업무보드에서 새 업무를 직접 생성합니다."
    )
    @PostMapping
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> createTask(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @RequestBody TaskCreateRequest request
    ) {
        if (request.title() == null || request.title().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("TITLE_REQUIRED", "업무 제목은 필수입니다."));
        }

        Long projectDbId = demoDataService.resolveProjectId(projectId);
        LocalDate startDate;
        try {
            startDate = parseDate(request.startDate());
        } catch (DateTimeParseException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_START_DATE", "startDate는 YYYY-MM-DD 형식이어야 합니다."));
        }
        LocalDate dueDate;
        try {
            dueDate = parseDate(request.dueDate());
        } catch (DateTimeParseException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_DUE_DATE", "dueDate는 YYYY-MM-DD 형식이어야 합니다."));
        }
        if (startDate != null || dueDate != null) {
            Project project = projectRepository.findById(projectDbId)
                .orElseThrow(() -> new IllegalArgumentException("프로젝트를 찾을 수 없습니다."));
            ProjectSchedulePolicy.validate(project, startDate, dueDate, "업무");
        }

        Long assigneeId;
        try {
            assigneeId = resolveAssigneeId(request.assigneeId());
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_ASSIGNEE_ID", "assigneeId 형식이 올바르지 않습니다."));
        }

        Long createdBy = currentActorId();
        String status = request.status() == null ? "todo" : request.status();
        // category는 DB NOT NULL이라 누락 시 저장 단계에서 예외가 나기 전에 기본값으로 방어한다.
        String category = defaultString(request.category(), "other");
        Task newTask = new Task(
            projectDbId,
            null,
            request.title(),
            category,
            status,
            assigneeId,
            startDate,
            dueDate,
            request.priority(),
            request.description(),
            "MANUAL",
            null,
            createdBy,
            nextAppendPosition(projectDbId, status)
        );
        newTask.setStartDate(startDate);
        newTask.setExtraFields(request.extraFields());
        Task task = taskRepository.save(newTask);
        activityService.record(projectDbId, createdBy, "TASK_CREATED", task.getId(), "'" + task.getTitle() + "' 업무를 새로 추가했습니다.");
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(createdBy)) {
            notificationService.notify(
                task.getAssigneeId(), "TASK_ASSIGNED", "새 업무가 배정되었습니다.",
                "'" + task.getTitle() + "' 업무가 배정되었습니다.", "task", task.getId()
            );
        }
        String ragContent = buildRagContent(task);
        ragIngestService.recordIngestIntent(
            projectDbId, "task", task.getId(), ragContent, task.getAssigneeId()
        );
        runAfterCommit(() ->
            ragIngestService.ingestBestEffort(
                projectDbId,
                "task",
                task.getId(),
                ragContent,
                task.getAssigneeId()
            )
        );
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    @Operation(
        summary = "업무 위치/상태 변경",
        description = "칸반 보드 드래그앤드롭으로 업무의 상태(컬럼)와 그 컬럼 안에서의 순서(position)를 함께 변경합니다."
    )
    @PatchMapping("/{taskId}/position")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> updatePosition(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody TaskPositionUpdateRequest request
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long currentUserId = CurrentUser.id();
        if (!isLeader(projectDbId, currentUserId) && !currentUserId.equals(task.getAssigneeId())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_OWNER", "본인이 담당자인 업무만 이동할 수 있습니다."));
        }
        // 완료 승인 대기 중인 업무는 팀장이 승인/반려하거나 담당자가 요청을 취소하기 전까지는
        // 프론트(TaskCard.canMove)와 마찬가지로 백엔드에서도 이동을 막는다 - 그렇지 않으면
        // pendingApproval=true인 채로 status만 바뀌어 완료 승인 화면과 실제 상태가 어긋난다.
        if (task.isPendingApproval()) {
            return ResponseEntity.status(409).body(ApiResponse.fail("PENDING_APPROVAL", "완료 승인 대기 중인 업무는 이동할 수 없습니다. 먼저 승인/반려하거나 요청을 취소해주세요."));
        }
        String previousStatus = task.getStatus();
        task.moveTo(request.status(), request.position());
        taskRepository.save(task);
        if (!previousStatus.equals(task.getStatus())) {
            String label = STATUS_LABELS.getOrDefault(task.getStatus(), task.getStatus());
            Long moveActorId = currentActorId();
            activityService.record(
                projectDbId, moveActorId, "STATUS_CHANGED", task.getId(),
                "'" + task.getTitle() + "' 상태를 '" + label + "'(으)로 변경했습니다."
            );
            String notificationContent = "'" + task.getTitle() + "' 업무가 '" + label + "'(으)로 이동했습니다.";
            if (task.getAssigneeId() != null && !task.getAssigneeId().equals(moveActorId)) {
                notificationService.notify(
                    task.getAssigneeId(), "STATUS_CHANGED", "담당 업무 상태가 변경되었습니다.",
                    notificationContent, "task", task.getId()
                );
            }
            projectMemberRepository.findAllByProjectId(projectDbId).stream()
                .filter(member -> member.getRole() == ProjectRole.LEADER)
                .map(com.workflowai.project.ProjectMember::getUserId)
                .filter(leaderId -> !leaderId.equals(moveActorId))
                .filter(leaderId -> !leaderId.equals(task.getAssigneeId()))
                .forEach(leaderId -> notificationService.notify(
                    leaderId, "STATUS_CHANGED", "업무 상태가 변경되었습니다.",
                    notificationContent, "task", task.getId()
                ));
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    @Operation(
        summary = "업무 수정",
        description = "업무의 제목/카테고리/담당자/마감일/우선순위/설명을 부분 수정합니다. null인 필드는 변경하지 않습니다."
    )
    @PatchMapping("/{taskId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> updateTask(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody TaskUpdateRequest request
    ) {
        if (request.title() != null && request.title().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("TITLE_REQUIRED", "업무 제목은 비워둘 수 없습니다."));
        }

        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }

        LocalDate startDate;
        try {
            startDate = parseDate(request.startDate());
        } catch (DateTimeParseException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_START_DATE", "startDate는 YYYY-MM-DD 형식이어야 합니다."));
        }
        LocalDate dueDate;
        try {
            dueDate = parseDate(request.dueDate());
        } catch (DateTimeParseException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_DUE_DATE", "dueDate는 YYYY-MM-DD 형식이어야 합니다."));
        }
        // applyUpdate는 null이면 기존값을 유지하므로, 검증도 "적용됐을 때의 실제 값" 기준으로 한다.
        LocalDate effectiveStartDate = startDate != null ? startDate : task.getStartDate();
        LocalDate effectiveDueDate = dueDate != null ? dueDate : task.getDueDate();
        if (request.startDate() != null || request.dueDate() != null) {
            Project project = projectRepository.findById(projectDbId)
                .orElseThrow(() -> new IllegalArgumentException("프로젝트를 찾을 수 없습니다."));
            ProjectSchedulePolicy.validate(project, effectiveStartDate, effectiveDueDate, "업무");
        }

        String titleBefore = task.getTitle();
        String categoryBefore = task.getCategory();
        Long assigneeBefore = task.getAssigneeId();
        LocalDate startDateBefore = task.getStartDate();
        LocalDate dueDateBefore = task.getDueDate();
        String priorityBefore = task.getPriority();
        String descriptionBefore = task.getDescription();

        Long newAssigneeId;
        try {
            newAssigneeId = resolveAssigneeId(request.assigneeId());
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_ASSIGNEE_ID", "assigneeId 형식이 올바르지 않습니다."));
        }
        task.applyUpdate(
            request.title(), request.category(), newAssigneeId, startDate, dueDate, request.priority(),
            request.description(), request.extraFields()
        );
        taskRepository.save(task);

        Long actorId = currentActorId();
        boolean assigneeChanged = !Objects.equals(assigneeBefore, task.getAssigneeId());
        boolean otherFieldsChanged = !Objects.equals(titleBefore, task.getTitle())
            || !Objects.equals(categoryBefore, task.getCategory())
            || !Objects.equals(startDateBefore, task.getStartDate())
            || !Objects.equals(dueDateBefore, task.getDueDate())
            || !Objects.equals(priorityBefore, task.getPriority())
            || !Objects.equals(descriptionBefore, task.getDescription());
        if (assigneeChanged) {
            // RAG 검색에서 "내가 담당한 업무"가 재배정 이후에도 옛 담당자에게 계속 잡히지
            // 않도록, 이미 인제스트된 청크의 assignee_id 메타데이터를 동기화한다.
            ragIngestService.recordAssigneeSyncIntent(projectDbId, "task", taskId, task.getAssigneeId());
            runAfterCommit(() ->
                ragIngestService.syncAssigneeBestEffort(projectDbId, "task", taskId, task.getAssigneeId())
            );
            activityService.record(
                projectDbId, actorId, "ASSIGNEE_CHANGED", task.getId(),
                "담당자를 '" + userName(task.getAssigneeId()) + "'(으)로 변경했습니다."
            );
            if (task.getAssigneeId() != null && !task.getAssigneeId().equals(actorId)) {
                notificationService.notify(
                    task.getAssigneeId(), "TASK_ASSIGNED", "업무 담당자로 지정되었습니다.",
                    "'" + task.getTitle() + "' 업무 담당자로 지정되었습니다.", "task", task.getId()
                );
            }
        }
        if (otherFieldsChanged) {
            String ragContent = buildRagContent(task);
            ragIngestService.recordIngestIntent(
                projectDbId, "task", task.getId(), ragContent, task.getAssigneeId()
            );
            runAfterCommit(() ->
                ragIngestService.ingestBestEffort(
                    projectDbId,
                    "task",
                    task.getId(),
                    ragContent,
                    task.getAssigneeId()
                )
            );
            activityService.record(projectDbId, actorId, "TASK_UPDATED", task.getId(), "'" + task.getTitle() + "' 업무 정보를 수정했습니다.");
            if (task.getAssigneeId() != null && !task.getAssigneeId().equals(actorId)) {
                notificationService.notify(
                    task.getAssigneeId(), "TASK_UPDATED", "담당 업무 정보가 수정되었습니다.",
                    "'" + task.getTitle() + "' 업무 정보가 수정되었습니다.", "task", task.getId()
                );
            }
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    private String buildRagContent(Task task) {
        if (task.getDescription() == null || task.getDescription().isBlank()) {
            return task.getTitle();
        }
        return task.getTitle() + " - " + task.getDescription();
    }

    private void runAfterCommit(Runnable operation) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runAfterCommitOperationSafely(operation);
                }
            });
            return;
        }
        runAfterCommitOperationSafely(operation);
    }

    private void runAfterCommitOperationSafely(Runnable operation) {
        try {
            operation.run();
        } catch (RuntimeException exception) {
            log.warn("RAG after-commit 작업 제출 실패. errorType={}", exception.getClass().getSimpleName());
        }
    }

    @Operation(
        summary = "업무 삭제",
        description = "업무를 영구적으로 삭제합니다."
    )
    @DeleteMapping("/{taskId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    @Transactional
    public ResponseEntity<ApiResponse<Void>> deleteTask(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        // 삭제되면 상세 화면이 바로 닫혀서 이 업무 자체의 피드에는 안 보이지만, 프로젝트 전체 활동 로그를 위해 남겨둔다.
        Long deleteActorId = currentActorId();
        activityService.record(projectDbId, deleteActorId, "TASK_DELETED", task.getId(), "'" + task.getTitle() + "' 업무를 삭제했습니다.");
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(deleteActorId)) {
            // targetId가 가리키는 업무는 이 트랜잭션이 끝나면 더 이상 존재하지 않는다 — 의도된 동작이다.
            // 삭제 알림은 targetId로 업무를 다시 조회하지 않고 title을 메시지에 그대로 박아 보여주므로,
            // 대상이 사라져도 알림 내용 자체는 그대로 유효하다.
            notificationService.notify(
                task.getAssigneeId(), "TASK_DELETED", "담당 업무가 삭제되었습니다.",
                "'" + task.getTitle() + "' 업무가 삭제되었습니다.", "task", task.getId()
            );
        }
        ragIngestService.recordDeleteSourceIntent(projectDbId, "task", taskId);
        taskRepository.delete(task);
        runAfterCommit(() -> ragIngestService.deleteSourceBestEffort(projectDbId, "task", taskId));
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @Operation(
        summary = "업무 알림(넛지) 보내기",
        description = "담당자에게 정형화된 메시지(업무 시작/진행상황 공유/긴급 확인)를 알림으로 보냅니다."
    )
    @PostMapping("/{taskId}/nudge")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<Void>> sendNudge(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody NudgeRequest request
    ) {
        if (request.kind() == null || request.kind().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_NUDGE_KIND", "알 수 없는 알림 종류입니다."));
        }
        String messageTemplate = NUDGE_MESSAGE_TEMPLATES.get(request.kind());
        if (messageTemplate == null) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_NUDGE_KIND", "알 수 없는 알림 종류입니다."));
        }
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long actorId = CurrentUser.id();
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(actorId)) {
            notificationService.notify(
                task.getAssigneeId(), "TASK_NUDGE", NUDGE_TITLES.get(request.kind()),
                String.format(messageTemplate, task.getTitle()), "task", task.getId()
            );
        }
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @Operation(
        summary = "완료 승인 대기 목록 조회",
        description = "팀원이 완료를 요청했고 아직 팀장이 승인/반려하지 않은 업무 목록을 조회합니다."
    )
    @GetMapping("/pending-approvals")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<List<TaskListItem>> getPendingApprovals(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        List<TaskListItem> tasks = taskRepository.findByProjectIdAndPendingApprovalTrueOrderByUpdatedAtAsc(projectDbId).stream()
            .map(TaskListItem::from)
            .toList();
        return ApiResponse.ok(tasks);
    }

    @Operation(
        summary = "완료 승인 요청",
        description = "담당자가 업무를 완료로 옮기기 전에 팀장에게 승인을 요청합니다. status는 바뀌지 않고 대기 상태만 켜집니다."
    )
    @PostMapping("/{taskId}/completion-request")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> requestCompletion(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long actorId = currentActorId();
        if (!actorId.equals(task.getAssigneeId())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_OWNER", "본인이 담당자인 업무만 완료를 요청할 수 있습니다."));
        }
        if (task.isPendingApproval()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("ALREADY_PENDING", "이미 승인 대기 중인 업무입니다."));
        }
        // "진행 중" -> "완료"로 옮길 때만 승인 요청이 의미가 있다. todo/blocked/이미 done인
        // 업무까지 요청할 수 있으면 완료 승인 워크플로우의 상태 정합성이 깨진다.
        if (!"inprogress".equals(task.getStatus())) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_STATUS_FOR_COMPLETION", "진행 중인 업무만 완료 승인을 요청할 수 있습니다."));
        }
        task.requestCompletion();
        taskRepository.save(task);
        activityService.record(projectDbId, actorId, "COMPLETION_REQUESTED", task.getId(), "'" + task.getTitle() + "' 업무의 완료 승인을 요청했습니다.");
        projectMemberRepository.findAllByProjectId(projectDbId).stream()
            .filter(member -> member.getRole() == ProjectRole.LEADER)
            .map(com.workflowai.project.ProjectMember::getUserId)
            .forEach(leaderId -> notificationService.notify(
                leaderId, "COMPLETION_REQUESTED", "완료 승인 요청이 도착했습니다.",
                "'" + task.getTitle() + "' 업무의 완료 승인을 요청했습니다.", "task", task.getId()
            ));
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    @Operation(
        summary = "완료 승인 요청 취소",
        description = "담당자가 본인이 올린 완료 승인 요청을 취소합니다. status는 바뀌지 않습니다."
    )
    @PostMapping("/{taskId}/completion-cancel")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> cancelCompletionRequest(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long actorId = currentActorId();
        if (!actorId.equals(task.getAssigneeId())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_OWNER", "본인이 담당자인 업무만 취소할 수 있습니다."));
        }
        if (!task.isPendingApproval()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("NOT_PENDING", "승인 대기 중인 업무가 아닙니다."));
        }
        task.cancelCompletionRequest();
        taskRepository.save(task);
        activityService.record(projectDbId, actorId, "COMPLETION_CANCELLED", task.getId(), "'" + task.getTitle() + "' 업무의 완료 승인 요청을 취소했습니다.");
        projectMemberRepository.findAllByProjectId(projectDbId).stream()
            .filter(member -> member.getRole() == ProjectRole.LEADER)
            .map(com.workflowai.project.ProjectMember::getUserId)
            .forEach(leaderId -> notificationService.notify(
                leaderId, "COMPLETION_CANCELLED", "완료 승인 요청이 취소되었습니다.",
                "'" + task.getTitle() + "' 업무의 완료 승인 요청이 취소되었습니다.", "task", task.getId()
            ));
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    @Operation(
        summary = "완료 승인",
        description = "팀장이 완료 승인 요청을 승인합니다. 업무가 실제로 완료 컬럼 맨 끝으로 이동합니다."
    )
    @PostMapping("/{taskId}/completion-approve")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> approveCompletion(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!task.isPendingApproval()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("NOT_PENDING", "승인 대기 중인 업무가 아닙니다."));
        }
        task.approveCompletion(nextAppendPosition(projectDbId, "done"));
        taskRepository.save(task);
        Long approverId = currentActorId();
        activityService.record(projectDbId, approverId, "COMPLETION_APPROVED", task.getId(), "'" + task.getTitle() + "' 업무의 완료를 승인했습니다.");
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(approverId)) {
            notificationService.notify(
                task.getAssigneeId(), "COMPLETION_APPROVED", "완료 승인이 완료되었습니다.",
                "'" + task.getTitle() + "' 업무가 완료로 승인되었습니다.", "task", task.getId()
            );
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    @Operation(
        summary = "완료 반려",
        description = "팀장이 완료 승인 요청을 반려합니다. status는 바뀌지 않고 대기 상태만 풀립니다."
    )
    @PostMapping("/{taskId}/completion-reject")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    @Transactional
    public ResponseEntity<ApiResponse<TaskListItem>> rejectCompletion(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!task.isPendingApproval()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("NOT_PENDING", "승인 대기 중인 업무가 아닙니다."));
        }
        task.rejectCompletion();
        taskRepository.save(task);
        Long rejecterId = currentActorId();
        activityService.record(projectDbId, rejecterId, "COMPLETION_REJECTED", task.getId(), "'" + task.getTitle() + "' 업무의 완료 요청을 반려했습니다.");
        if (task.getAssigneeId() != null && !task.getAssigneeId().equals(rejecterId)) {
            notificationService.notify(
                task.getAssigneeId(), "COMPLETION_REJECTED", "완료 요청이 반려되었습니다.",
                "'" + task.getTitle() + "' 업무의 완료 요청이 반려되었습니다.", "task", task.getId()
            );
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskListItem.from(task)));
    }

    private boolean isLeader(Long projectId, Long userId) {
        return projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
            .map(member -> member.getRole() == ProjectRole.LEADER)
            .orElse(false);
    }

    private static LocalDate parseDate(String date) {
        return date == null || date.isBlank() ? null : LocalDate.parse(date);
    }

    private static String defaultString(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
