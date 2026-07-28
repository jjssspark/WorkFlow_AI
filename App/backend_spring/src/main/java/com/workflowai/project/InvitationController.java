package com.workflowai.project;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "초대", description = "프로젝트 팀원/심사자 초대 생성 및 수락")
@RestController
public class InvitationController {
    private final InvitationService invitationService;

    public InvitationController(InvitationService invitationService) {
        this.invitationService = invitationService;
    }

    @Operation(summary = "팀원 또는 심사자 초대 생성", description = "팀장만 가능하다.")
    @PostMapping("/api/v1/projects/{projectId}/invitations")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<InvitationResponse> create(
        @PathVariable Long projectId,
        @Valid @RequestBody CreateInvitationRequest request
    ) {
        return ApiResponse.ok(invitationService.create(projectId, request));
    }

    @Operation(
        summary = "초대 토큰을 사용해 프로젝트 참여 수락",
        description = "토큰이 이메일 초대(Invitation) 테이블에 없으면 404/INVITE_NOT_FOUND를 반환한다. "
            + "프론트엔드는 이 코드일 때만 프로젝트 참여 코드(inviteCode)로의 폴백을 시도해야 한다 — "
            + "이미 처리됐거나(409) 만료된(409) 초대는 폴백 대상이 아니라 사용자에게 그대로 알려야 한다."
    )
    @PostMapping("/api/v1/invitations/{token}/accept")
    public ResponseEntity<ApiResponse<Void>> accept(@PathVariable String token) {
        try {
            invitationService.accept(token, CurrentUser.id());
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.fail("INVITE_NOT_FOUND", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail("INVITE_ALREADY_PROCESSED", e.getMessage()));
        }
    }
}
