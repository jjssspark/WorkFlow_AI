package com.workflowai.comment;

import com.workflowai.common.ApiResponse;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.security.CurrentUser;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "개인 코멘트", description = "심사자가 팀원에게 남기는 개인 코멘트와 그에 대한 답글")
@RestController
@RequestMapping("/api/v1/projects/{projectId}")
public class PersonalCommentController {
    private static final int MAX_COMMENTS = 10;
    private static final int PREVIEW_LENGTH = 50;

    private final PersonalCommentRepository personalCommentRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final UserRepository userRepository;
    private final NotificationService notificationService;

    public PersonalCommentController(
        PersonalCommentRepository personalCommentRepository,
        ProjectMemberRepository projectMemberRepository,
        UserRepository userRepository,
        NotificationService notificationService
    ) {
        this.personalCommentRepository = personalCommentRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.userRepository = userRepository;
        this.notificationService = notificationService;
    }

    private String authorNameOf(Long authorId) {
        return userRepository.findById(authorId).map(User::getName).orElse("알 수 없음");
    }

    private String preview(String content) {
        return content.length() > PREVIEW_LENGTH ? content.substring(0, PREVIEW_LENGTH) + "..." : content;
    }

    @Operation(
        summary = "개인 코멘트 작성",
        description = "심사자가 프로젝트 내 특정 팀원에게 새 코멘트를 남긴다. 심사자만 호출 가능하다."
    )
    @PostMapping("/members/{targetUserId}/comments")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    @Transactional
    public ResponseEntity<ApiResponse<PersonalCommentDto>> create(
        @Parameter(description = "프로젝트 ID") @PathVariable Long projectId,
        @Parameter(description = "코멘트를 받을 팀원 ID") @PathVariable Long targetUserId,
        @RequestBody PersonalCommentCreateRequest request
    ) {
        if (request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_REQUIRED", "코멘트 내용은 필수입니다."));
        }
        if (!projectMemberRepository.existsByProjectIdAndUserId(projectId, targetUserId)) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail("USER_NOT_PROJECT_MEMBER", "해당 사용자는 이 프로젝트의 멤버가 아닙니다."));
        }
        Long authorId = CurrentUser.id();
        PersonalComment saved = personalCommentRepository.save(
            new PersonalComment(projectId, "personal", targetUserId, authorId, request.content(), null)
        );
        enforceLimit(projectId, targetUserId, saved.getId());
        notificationService.notifyAfterCommit(
            targetUserId, projectId, "PERSONAL_COMMENT", "새 코멘트가 도착했습니다",
            preview(request.content()), "personal_comment", saved.getId()
        );
        return ResponseEntity.ok(ApiResponse.ok(PersonalCommentDto.from(saved, authorNameOf(authorId))));
    }

    @Operation(
        summary = "코멘트에 답글 작성",
        description = "코멘트를 받은 팀원 본인만 호출 가능하다. 이미 답글인 코멘트에는 답글을 달 수 없다(1단계만 허용)."
    )
    @PostMapping("/comments/{commentId}/replies")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    @Transactional
    public ResponseEntity<ApiResponse<PersonalCommentDto>> reply(
        @Parameter(description = "프로젝트 ID") @PathVariable Long projectId,
        @Parameter(description = "답글을 달 원 코멘트 ID") @PathVariable Long commentId,
        @RequestBody PersonalCommentCreateRequest request
    ) {
        if (request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("CONTENT_REQUIRED", "답글 내용은 필수입니다."));
        }
        PersonalComment parent = personalCommentRepository.findById(commentId).orElse(null);
        if (parent == null || !parent.getProjectId().equals(projectId)) {
            return ResponseEntity.status(404).body(ApiResponse.fail("COMMENT_NOT_FOUND", "코멘트를 찾을 수 없습니다."));
        }
        if (parent.getParentId() != null) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail("REPLY_TO_REPLY_NOT_ALLOWED", "답글에는 답글을 달 수 없습니다."));
        }
        Long authorId = CurrentUser.id();
        if (!parent.getTargetUserId().equals(authorId)) {
            return ResponseEntity.status(403)
                .body(ApiResponse.fail("FORBIDDEN_NOT_TARGET_USER", "본인이 받은 코멘트에만 답글을 달 수 있습니다."));
        }
        boolean replyAlreadyExists = personalCommentRepository
            .findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(projectId, parent.getTargetUserId())
            .stream()
            .anyMatch(c -> parent.getId().equals(c.getParentId()));
        if (replyAlreadyExists) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail("REPLY_ALREADY_EXISTS", "이미 답글이 작성된 코멘트입니다."));
        }
        PersonalComment saved = personalCommentRepository.save(
            new PersonalComment(projectId, "personal", parent.getTargetUserId(), authorId, request.content(), parent.getId())
        );
        enforceLimit(projectId, parent.getTargetUserId(), parent.getId());
        notificationService.notifyAfterCommit(
            parent.getAuthorId(), projectId, "PERSONAL_COMMENT_REPLY", "답글이 달렸습니다",
            preview(request.content()), "personal_comment", parent.getId()
        );
        return ResponseEntity.ok(ApiResponse.ok(PersonalCommentDto.from(saved, authorNameOf(authorId))));
    }

    /**
     * (project_id, target_user_id) 스레드의 표시 개수를 10건으로 유지한다. 가장 오래된 것부터
     * 지우되, 삭제되는 원 코멘트에 딸린 답글이 삭제 대상에 포함돼 있지 않더라도(답글이 더 최신이라
     * "유지" 구간에 있더라도) 함께 지운다 — 원 코멘트 없는 답글만 남는 것을 막기 위함. DB의
     * ON DELETE CASCADE에만 맡기면 이 메서드 실행 후 실제 남은 개수를 코드에서 예측할 수 없으므로
     * 애플리케이션 코드에서 명시적으로 정리한다.
     *
     * protectedRootId는 이번 요청이 생성/응답 중인 원 코멘트의 id다(create는 방금 저장한 코멘트
     * 자신의 id, reply는 답글 대상 원 코멘트의 id). 이 원 코멘트와 그 답글은 "가장 오래된 것부터
     * excess개" 계산에서 제외해, 방금 만든 결과가 자기 자신의 정리 로직에 의해 지워지는 것을 막는다.
     * 보호 대상을 뺀 후보가 excess개보다 적으면(즉 보호 대상이 마침 가장 오래된 항목들이면), 이번
     * 요청에 한해 스레드가 MAX_COMMENTS보다 하나 더 늘어나는 것을 허용한다 — 방금 생성한 결과를
     * 절대 지우지 않는 쪽을 우선한다.
     */
    private void enforceLimit(Long projectId, Long targetUserId, Long protectedRootId) {
        List<PersonalComment> all = personalCommentRepository
            .findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(projectId, targetUserId);
        int excess = all.size() - MAX_COMMENTS;
        if (excess <= 0) {
            return;
        }
        List<PersonalComment> candidates = all.stream()
            .filter(comment -> !isProtected(comment, protectedRootId))
            .toList();
        List<PersonalComment> toDelete = candidates.subList(0, Math.min(excess, candidates.size()));
        Set<Long> deletedParentIds = new HashSet<>();
        Set<Long> idsToDelete = new HashSet<>();
        for (PersonalComment comment : toDelete) {
            idsToDelete.add(comment.getId());
            if (comment.getParentId() == null) {
                deletedParentIds.add(comment.getId());
            }
        }
        for (PersonalComment comment : all) {
            if (comment.getParentId() != null && deletedParentIds.contains(comment.getParentId())
                && !isProtected(comment, protectedRootId)) {
                idsToDelete.add(comment.getId());
            }
        }
        personalCommentRepository.deleteAllByIdInBatch(idsToDelete);
    }

    private boolean isProtected(PersonalComment comment, Long protectedRootId) {
        return protectedRootId != null
            && (protectedRootId.equals(comment.getId()) || protectedRootId.equals(comment.getParentId()));
    }
}
