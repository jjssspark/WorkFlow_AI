package com.workflowai.project;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
        summary = "링크 공유용 팀원 초대 토큰 발급",
        description = "팀장만 가능하다. 역할은 항상 팀원으로 고정된다. 아직 아무도 쓰지 않은 유효한 링크 초대가 "
            + "이미 있으면 새로 만들지 않고 재사용한다."
    )
    @PostMapping("/api/v1/projects/{projectId}/invitations/link")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<InvitationResponse> createLink(@PathVariable Long projectId) {
        return ApiResponse.ok(invitationService.createLinkInvitation(projectId));
    }

    @Operation(
        summary = "초대 토큰을 사용해 프로젝트 참여 수락",
        description = "성공하면 참여한 projectId를 돌려준다. 토큰에 해당하는 초대가 없으면 "
            + "404/INVITE_NOT_FOUND다 — 프론트엔드는 이 코드일 때만 프로젝트 참여 코드(inviteCode)로의 "
            + "폴백을 시도해야 한다. 이미 처리된 초대(409/INVITE_ALREADY_PROCESSED)와 만료된 초대"
            + "(409/INVITE_EXPIRED)는 폴백 대상이 아니라 사용자에게 그대로 알려야 한다. "
            + "그 밖의 예외는 500으로 나간다 — 결함을 '초대 없음'으로 위장시키지 않기 위해서다."
    )
    @PostMapping("/api/v1/invitations/{token}/accept")
    public ApiResponse<AcceptInvitationResponse> accept(@PathVariable String token) {
        // 실패 분기는 InvitationException + GlobalExceptionHandler가 맡는다. 여기서 예외를
        // 넓게 잡으면 서비스가 의도한 실패와 그 아래에서 우연히 터진 결함을 구분할 수 없다.
        Long projectId = invitationService.accept(token, CurrentUser.id());
        return ApiResponse.ok(new AcceptInvitationResponse(projectId));
    }
}
