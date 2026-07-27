package com.workflowai.project;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "프로젝트", description = "프로젝트 생성/조회/수정/삭제 및 멤버 역할 관리")
@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {
    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @Operation(summary = "내가 접근 가능한 프로젝트 목록 조회")
    @GetMapping
    public ApiResponse<List<ProjectResponse>> list() {
        return ApiResponse.ok(projectService.findAllForUser(CurrentUser.id()));
    }

    @Operation(
        summary = "프로젝트 생성 (온보딩)",
        description = "생성한 사용자는 자동으로 팀장(LEADER)이 되어 project_members에 등록된다. "
            + "프로젝트명은 필수이며, 일정/산출물/기술스택 정보는 선택 입력이다. 유효성 검사 실패 시 400을 반환한다."
    )
    @PostMapping
    public ResponseEntity<ApiResponse<ProjectResponse>> create(@Valid @RequestBody CreateProjectRequest request) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(projectService.create(CurrentUser.id(), request)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.fail("INVALID_PROJECT_INPUT", e.getMessage()));
        }
    }

    @Operation(
        summary = "초대 코드로 프로젝트 참여",
        description = "코드가 유효하면 현재 로그인한 사용자를 팀원(MEMBER)으로 project_members에 등록한다."
    )
    @PostMapping("/join")
    public ResponseEntity<ApiResponse<ProjectResponse>> join(@Valid @RequestBody JoinProjectRequest request) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(projectService.joinByCode(CurrentUser.id(), request.code())));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.fail("INVALID_INVITE_CODE", e.getMessage()));
        }
    }

    @Operation(summary = "프로젝트 상세 조회")
    @GetMapping("/{projectId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<ProjectResponse> find(@PathVariable Long projectId) {
        return ApiResponse.ok(projectService.find(projectId));
    }

    @Operation(summary = "프로젝트 수정", description = "팀장만 가능하다. 팀원/심사자가 호출하면 403을 반환한다.")
    @PatchMapping("/{projectId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<ProjectResponse>> update(
        @PathVariable Long projectId,
        @RequestBody UpdateProjectRequest request
    ) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(projectService.update(projectId, request)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.fail("INVALID_PROJECT_INPUT", e.getMessage()));
        }
    }

    @Operation(summary = "프로젝트 삭제", description = "팀장만 가능하다.")
    @DeleteMapping("/{projectId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<Void> delete(@PathVariable Long projectId) {
        projectService.delete(projectId);
        return ApiResponse.ok(null);
    }

    @Operation(
        summary = "평가 확정",
        description = "프로젝트 평가 진행 상태(eval_status)를 PUBLISHED로 전이한다. 심사자만 가능하다. "
            + "확정 후에도 팀원별 평가 점수/공개 여부는 계속 수정할 수 있다(단순 상태 표시용, 잠금 아님)."
    )
    @PostMapping("/{projectId}/finalize-evaluation")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    public ApiResponse<ProjectResponse> finalizeEvaluation(@PathVariable Long projectId) {
        return ApiResponse.ok(projectService.finalizeEvaluation(projectId));
    }

    @Operation(summary = "프로젝트 멤버 목록 조회")
    @GetMapping("/{projectId}/members")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<MemberResponse>> members(@PathVariable Long projectId) {
        return ApiResponse.ok(projectService.members(projectId));
    }

    @Operation(summary = "프로젝트 멤버 역할 변경", description = "팀장만 가능하다.")
    @PatchMapping("/{projectId}/members/{userId}/role")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<MemberResponse> updateMemberRole(
        @PathVariable Long projectId,
        @PathVariable Long userId,
        @Valid @RequestBody UpdateMemberRoleRequest request
    ) {
        return ApiResponse.ok(projectService.updateMemberRole(projectId, userId, request.role()));
    }
}
