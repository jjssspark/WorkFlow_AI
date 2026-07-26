package com.workflowai.dashboard.controller;

import com.workflowai.common.ApiResponse;
import com.workflowai.dashboard.DTO.ActivityItemDto;
import com.workflowai.dashboard.DTO.CreateMilestoneRequest;
import com.workflowai.dashboard.DTO.DashboardTaskDto;
import com.workflowai.dashboard.DTO.DashboardSummaryResponse;
import com.workflowai.dashboard.DTO.DelayRiskDto;
import com.workflowai.dashboard.DTO.MilestoneProgressDto;
import com.workflowai.dashboard.DTO.ProgressDetailResponse;
import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import com.workflowai.dashboard.service.DashboardService;
import com.workflowai.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "대시보드", description = "메인 대시보드 / 전체 진행률 조회 API")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/dashboard")
public class DashboardController {
    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @Operation(summary = "메인 대시보드 요약", description = "전체 업무 통계, 마감 임박 업무, 팀원별 업무량, 최근 활동을 반환한다.")
    @GetMapping("/summary")
    public ApiResponse<DashboardSummaryResponse> getSummary(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getSummary(projectId));
    }

    @Operation(summary = "대시보드 업무 목록", description = "대시보드 상세 화면에서 사용하는 실제 업무 목록을 반환한다.")
    @GetMapping("/tasks")
    public ApiResponse<List<DashboardTaskDto>> getTasks(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getTasks(projectId));
    }

    @Operation(summary = "대시보드 최근 활동", description = "프로젝트 최근 활동을 최신순으로 최대 50건 반환한다.")
    @GetMapping("/activities")
    public ApiResponse<List<ActivityItemDto>> getActivities(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getActivities(projectId));
    }

    @Operation(summary = "전체 진행률 상세", description = "마일스톤/카테고리별 진행률과 AI 지연 위험도(ml_predictions)를 반환한다.")
    @GetMapping("/progress")
    public ApiResponse<ProgressDetailResponse> getProgress(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getProgressDetail(projectId));
    }

    @Operation(
        summary = "내 업무 지연 위험도",
        description = "현재 로그인한 사용자가 담당자인 업무 중 AI 지연 위험도가 '정상'이 아닌 업무 목록을 반환한다."
    )
    @GetMapping("/delay-risk/mine")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<DelayRiskDto>> getMyDelayRisks(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getMyDelayRisks(projectId, CurrentUser.id()));
    }

    @Operation(
        summary = "팀원별 업무 편중 점수",
        description = "ML 업무 편중 점수 모델(ml_workload_score)로 팀원별 과부하/저활동 탐지 결과를 반환한다. "
            + "결과는 저장되지 않고 호출 시점에 매번 새로 계산된다(FastAPI 라이브 조회)."
    )
    @GetMapping("/workload-score")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<WorkloadScoreResponseDto>> getWorkloadScore(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(dashboardService.getWorkloadScore(projectId)));
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResponse.fail("WORKLOAD_SCORE_UNAVAILABLE", "업무 편중 점수를 조회하지 못했습니다."));
        }
    }

    @Operation(summary = "마일스톤 생성", description = "프로젝트에 새 마일스톤을 추가한다.")
    @PostMapping("/milestones")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<MilestoneProgressDto> createMilestone(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Valid @RequestBody CreateMilestoneRequest request
    ) {
        return ApiResponse.ok(dashboardService.createMilestone(projectId, request.title(), request.dueDate()));
    }

    @Operation(
        summary = "AI 지연 위험도 재분석",
        description = "FastAPI(ml_delay_risk)에 재예측을 요청해 ml_predictions을 갱신한 뒤, 최신 진행률 상세를 반환한다. "
            + "FastAPI 호출이 실패해도 기존에 저장된 예측으로 계속 응답한다."
    )
    @PostMapping("/delay-risk/refresh")
    public ApiResponse<ProgressDetailResponse> refreshDelayRisk(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.refreshDelayRiskAndGetProgress(projectId));
    }
}
