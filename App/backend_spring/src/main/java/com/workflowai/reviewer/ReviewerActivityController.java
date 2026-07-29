package com.workflowai.reviewer;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "심사자", description = "심사자 홈 활동 기록 API")
@RestController
@RequestMapping("/api/v1")
public class ReviewerActivityController {
    private final ReviewerActivityService reviewerActivityService;

    public ReviewerActivityController(ReviewerActivityService reviewerActivityService) {
        this.reviewerActivityService = reviewerActivityService;
    }

    @Operation(
        summary = "내 최근 심사 활동 조회",
        description = "심사자 홈의 '최근 심사 활동' 카드와 배정 프로젝트 목록의 최근 접속순 정렬에 쓴다. "
            + "활동 기록이 없으면 두 목록 모두 빈 배열이다."
    )
    @GetMapping("/me/reviewer-activities")
    public ApiResponse<ReviewerActivityHomeResponse> myActivities() {
        return ApiResponse.ok(reviewerActivityService.getHomeActivities(CurrentUser.id()));
    }

    @Operation(
        summary = "심사 프로젝트 접속 기록",
        description = "심사자가 홈에서 배정 프로젝트로 진입할 때 호출한다. 이 기록이 '최근 접속 날짜'와 "
            + "프로젝트 목록 정렬의 근거가 된다. 심사자만 호출 가능하다."
    )
    @PostMapping("/projects/{projectId}/reviewer-access")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    public ApiResponse<Void> recordAccess(
        @Parameter(description = "프로젝트 ID", example = "1") @PathVariable Long projectId
    ) {
        reviewerActivityService.record(CurrentUser.id(), projectId, ReviewerActivityType.PROJECT_ACCESS);
        return ApiResponse.ok(null);
    }
}
