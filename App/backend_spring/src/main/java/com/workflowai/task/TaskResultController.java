package com.workflowai.task;

import com.workflowai.common.ApiResponse;
import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "업무 작업 내용", description = "업무 상세의 \"작업 내용 작성\" 패널(내용/링크/첨부파일) API. 담당자만 쓸 수 있다.")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/tasks/{taskId}/result")
public class TaskResultController {
    private static final Logger log = LoggerFactory.getLogger(TaskResultController.class);
    private static final int SIGNED_URL_EXPIRES_SECONDS = 3600;
    private static final int MAX_URL_LENGTH = 2000;
    private static final int MAX_TITLE_LENGTH = 200;
    private static final int MAX_FILE_NAME_LENGTH = 255;
    private static final int MAX_CONTENT_LENGTH = 2000;

    private final TaskResultRepository taskResultRepository;
    private final TaskResultLinkRepository taskResultLinkRepository;
    private final TaskResultFileRepository taskResultFileRepository;
    private final TaskRepository taskRepository;
    private final DemoDataService demoDataService;
    private final SupabaseStorageClient storageClient;
    private final ProjectMemberRepository projectMemberRepository;

    public TaskResultController(
        TaskResultRepository taskResultRepository,
        TaskResultLinkRepository taskResultLinkRepository,
        TaskResultFileRepository taskResultFileRepository,
        TaskRepository taskRepository,
        DemoDataService demoDataService,
        SupabaseStorageClient storageClient,
        ProjectMemberRepository projectMemberRepository
    ) {
        this.taskResultRepository = taskResultRepository;
        this.taskResultLinkRepository = taskResultLinkRepository;
        this.taskResultFileRepository = taskResultFileRepository;
        this.taskRepository = taskRepository;
        this.demoDataService = demoDataService;
        this.storageClient = storageClient;
        this.projectMemberRepository = projectMemberRepository;
    }

    private Task resolveTaskOrNull(String projectId, Long taskId) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        Task task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !task.getProjectId().equals(projectDbId)) {
            return null;
        }
        return task;
    }

    private boolean isAssignee(Task task, Long userId) {
        return userId != null && task.getAssigneeId() != null && task.getAssigneeId().equals(userId);
    }

    private boolean isLeader(Long projectId, Long userId) {
        return userId != null && projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
            .map(member -> member.getRole() == ProjectRole.LEADER)
            .orElse(false);
    }

    /** 담당자 본인이거나 팀장만 작업 내용(내용/링크/첨부파일)을 쓸 수 있다. */
    private boolean canEditResult(Task task, Long userId) {
        return isAssignee(task, userId) || isLeader(task.getProjectId(), userId);
    }

    /** 정규식 대신 URI 파서로 검증해 스킴은 맞지만 호스트가 없는 등 형식이 잘못된 URL을 걸러낸다. */
    private boolean isValidHttpUrl(String url) {
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            return scheme != null
                && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                && uri.getHost() != null
                && !uri.getHost().isBlank();
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** '/', '\', '..' 등 경로 조작에 쓰일 수 있는 문자를 제거해 Storage 경로 조작을 막는다. */
    private String sanitizeForStoragePath(String name) {
        String base = name.replace('\\', '/');
        int lastSlash = base.lastIndexOf('/');
        if (lastSlash >= 0) {
            base = base.substring(lastSlash + 1);
        }
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.isBlank() || base.chars().allMatch(c -> c == '.')) {
            base = "file";
        }
        return base;
    }

    private List<TaskResultLinkDto> links(Long taskId) {
        return taskResultLinkRepository.findByTaskIdOrderByCreatedAtAsc(taskId).stream()
            .map(TaskResultLinkDto::from)
            .toList();
    }

    private List<TaskResultFileDto> files(Long taskId) {
        return taskResultFileRepository.findByTaskIdOrderByCreatedAtAsc(taskId).stream()
            .map(TaskResultFileDto::from)
            .toList();
    }

    @Operation(summary = "작업 내용 조회", description = "저장된 작업 내용, 관련 링크, 첨부파일 목록을 조회합니다.")
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<TaskResultDto>> getResult(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId
    ) {
        if (resolveTaskOrNull(projectId, taskId) == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        TaskResult result = taskResultRepository.findByTaskId(taskId).orElse(null);
        TaskResultDto dto = result == null
            ? TaskResultDto.empty(links(taskId), files(taskId))
            : TaskResultDto.from(result, links(taskId), files(taskId));
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    @Operation(summary = "작업 내용 저장", description = "작업 내용을 생성하거나 수정합니다(upsert). 담당자만 가능합니다.")
    @PutMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<TaskResultDto>> saveResult(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody TaskResultSaveRequest request
    ) {
        if (request.content() == null) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_REQUIRED", "작업 내용은 필수입니다."));
        }
        if (request.content().length() > MAX_CONTENT_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_TOO_LONG", "작업 내용은 " + MAX_CONTENT_LENGTH + "자를 초과할 수 없습니다."));
        }
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!canEditResult(task, CurrentUser.id())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_ASSIGNEE", "담당자만 작업 내용을 작성할 수 있습니다."));
        }
        TaskResult result = taskResultRepository.findByTaskId(taskId).orElse(null);
        if (result == null) {
            result = new TaskResult(taskId, request.content());
        } else {
            result.setContent(request.content());
        }
        try {
            taskResultRepository.save(result);
        } catch (DataIntegrityViolationException e) {
            // 동시 요청이 먼저 행을 만든 경우(task_id UNIQUE 충돌): 재조회해 수정으로 전환한다.
            result = taskResultRepository.findByTaskId(taskId).orElseThrow(() -> e);
            result.setContent(request.content());
            taskResultRepository.save(result);
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskResultDto.from(result, links(taskId), files(taskId))));
    }

    @Operation(summary = "관련 링크 추가", description = "작업 내용에 관련 링크를 추가합니다. 담당자만 가능합니다.")
    @PostMapping("/links")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<TaskResultLinkDto>> addLink(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestBody TaskResultLinkCreateRequest request
    ) {
        if (request.url() == null || request.url().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("URL_REQUIRED", "URL은 필수입니다."));
        }
        if (!isValidHttpUrl(request.url())) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("URL_INVALID_SCHEME", "URL은 http:// 또는 https://로 시작하는 올바른 형식이어야 합니다."));
        }
        if (request.url().length() > MAX_URL_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("URL_TOO_LONG", "URL은 " + MAX_URL_LENGTH + "자를 초과할 수 없습니다."));
        }
        if (request.title() != null && request.title().length() > MAX_TITLE_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("TITLE_TOO_LONG", "제목은 " + MAX_TITLE_LENGTH + "자를 초과할 수 없습니다."));
        }
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!canEditResult(task, CurrentUser.id())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_ASSIGNEE", "담당자만 링크를 추가할 수 있습니다."));
        }
        String title = (request.title() == null || request.title().isBlank()) ? request.url() : request.title();
        if (title.length() > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH);
        }
        TaskResultLink saved = taskResultLinkRepository.save(new TaskResultLink(taskId, request.url(), title));
        return ResponseEntity.ok(ApiResponse.ok(TaskResultLinkDto.from(saved)));
    }

    @Operation(summary = "관련 링크 삭제", description = "담당자만 가능합니다.")
    @DeleteMapping("/links/{linkId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<Void>> deleteLink(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @Parameter(description = "링크 ID") @PathVariable Long linkId
    ) {
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!canEditResult(task, CurrentUser.id())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_ASSIGNEE", "담당자만 링크를 삭제할 수 있습니다."));
        }
        TaskResultLink link = taskResultLinkRepository.findById(linkId).orElse(null);
        if (link == null || !link.getTaskId().equals(taskId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("LINK_NOT_FOUND", "링크를 찾을 수 없습니다."));
        }
        taskResultLinkRepository.delete(link);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @Operation(summary = "첨부파일 업로드", description = "Supabase Storage에 업로드하고 메타데이터를 저장합니다. 담당자만 가능합니다.")
    @PostMapping(value = "/files")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<TaskResultFileDto>> uploadFile(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @RequestParam MultipartFile file
    ) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_REQUIRED", "파일이 비어있습니다."));
        }
        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "file";
        if (originalName.length() > MAX_FILE_NAME_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_NAME_TOO_LONG", "파일명은 " + MAX_FILE_NAME_LENGTH + "자를 초과할 수 없습니다."));
        }
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        Long uploaderId = CurrentUser.id();
        if (!canEditResult(task, uploaderId)) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_ASSIGNEE", "담당자만 파일을 업로드할 수 있습니다."));
        }
        String storagePath = "tasks/" + taskId + "/" + UUID.randomUUID() + "-" + sanitizeForStoragePath(originalName);
        try (InputStream in = file.getInputStream()) {
            storageClient.upload(storagePath, in, file.getSize(), file.getContentType());
        } catch (IOException | RuntimeException e) {
            log.error("Supabase Storage 업로드 실패: taskId={}, path={}", taskId, storagePath, e);
            return ResponseEntity.status(502).body(ApiResponse.fail("STORAGE_UPLOAD_FAILED", "파일 업로드에 실패했습니다."));
        }
        TaskResultFile saved;
        try {
            saved = taskResultFileRepository.save(
                new TaskResultFile(taskId, originalName, storagePath, file.getSize(), file.getContentType(), uploaderId)
            );
        } catch (RuntimeException e) {
            log.error("파일 메타데이터 저장 실패, Storage 객체를 정리합니다: taskId={}, path={}", taskId, storagePath, e);
            try {
                storageClient.delete(storagePath);
            } catch (RuntimeException cleanupError) {
                log.error("고아 Storage 객체 정리 실패: path={}", storagePath, cleanupError);
            }
            return ResponseEntity.status(500).body(ApiResponse.fail("FILE_SAVE_FAILED", "파일 정보를 저장하지 못했습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(TaskResultFileDto.from(saved)));
    }

    @Operation(summary = "첨부파일 삭제", description = "담당자만 가능합니다.")
    @DeleteMapping("/files/{fileId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<Void>> deleteFile(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @Parameter(description = "파일 ID") @PathVariable Long fileId
    ) {
        Task task = resolveTaskOrNull(projectId, taskId);
        if (task == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        if (!canEditResult(task, CurrentUser.id())) {
            return ResponseEntity.status(403).body(ApiResponse.fail("FORBIDDEN_NOT_ASSIGNEE", "담당자만 파일을 삭제할 수 있습니다."));
        }
        TaskResultFile taskResultFile = taskResultFileRepository.findById(fileId).orElse(null);
        if (taskResultFile == null || !taskResultFile.getTaskId().equals(taskId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("FILE_NOT_FOUND", "파일을 찾을 수 없습니다."));
        }
        taskResultFileRepository.delete(taskResultFile);
        try {
            storageClient.delete(taskResultFile.getStoragePath());
        } catch (RuntimeException firstError) {
            try {
                storageClient.delete(taskResultFile.getStoragePath());
            } catch (RuntimeException retryError) {
                log.error(
                    "메타데이터 삭제 후 Storage 객체 정리 실패(재시도 포함, 고아 객체로 남을 수 있음): fileId={}, path={}",
                    fileId, taskResultFile.getStoragePath(), retryError
                );
            }
        }
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @Operation(summary = "첨부파일 다운로드 URL 발급", description = "만료시간이 있는 임시 다운로드 URL을 발급합니다.")
    @GetMapping("/files/{fileId}/url")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<String>> getFileUrl(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "업무 ID") @PathVariable Long taskId,
        @Parameter(description = "파일 ID") @PathVariable Long fileId
    ) {
        if (resolveTaskOrNull(projectId, taskId) == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        }
        TaskResultFile taskResultFile = taskResultFileRepository.findById(fileId).orElse(null);
        if (taskResultFile == null || !taskResultFile.getTaskId().equals(taskId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("FILE_NOT_FOUND", "파일을 찾을 수 없습니다."));
        }
        try {
            String url = storageClient.createSignedUrl(
                taskResultFile.getStoragePath(), SIGNED_URL_EXPIRES_SECONDS, taskResultFile.getFileName()
            );
            return ResponseEntity.ok(ApiResponse.ok(url));
        } catch (RuntimeException e) {
            log.error("Supabase Storage signed URL 발급 실패: fileId={}, path={}", fileId, taskResultFile.getStoragePath(), e);
            return ResponseEntity.status(502).body(ApiResponse.fail("STORAGE_URL_FAILED", "다운로드 URL 발급에 실패했습니다."));
        }
    }
}
