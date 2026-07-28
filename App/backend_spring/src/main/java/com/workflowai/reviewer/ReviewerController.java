package com.workflowai.reviewer;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "심사자", description = "심사자 마이페이지 전용 API")
@RestController
@RequestMapping("/api/v1/me")
public class ReviewerController {
    private final ReviewerService reviewerService;

    public ReviewerController(ReviewerService reviewerService) {
        this.reviewerService = reviewerService;
    }

    @Operation(
        summary = "내가 심사자로 배정된 프로젝트 목록",
        description = "현재 로그인한 사용자가 REVIEWER 역할로 배정된 모든 프로젝트를 반환한다. 심사자가 아니면 빈 배열을 반환한다."
    )
    @GetMapping("/reviewer-projects")
    public ApiResponse<List<ReviewerProjectSummary>> myReviewProjects() {
        return ApiResponse.ok(reviewerService.getMyReviewProjects(CurrentUser.id()));
    }

    @Operation(
        summary = "심사자 홈 최근 심사 활동",
        description = "현재 로그인한 심사자가 남긴 기여 점수/학점 공개 전환·심사 코멘트 저장·평가 확정/취소 "
            + "활동을 최신순 최대 10건 반환한다. 심사 활동이 없으면 빈 배열을 반환한다."
    )
    @GetMapping("/reviewer-activities")
    public ApiResponse<List<ReviewerActivityDto>> myRecentActivities() {
        return ApiResponse.ok(reviewerService.getMyRecentActivities(CurrentUser.id()));
    }
}
