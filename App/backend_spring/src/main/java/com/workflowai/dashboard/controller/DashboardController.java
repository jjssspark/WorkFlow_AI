package com.workflowai.dashboard.controller;

import com.workflowai.common.ApiResponse;
import com.workflowai.dashboard.DTO.ActivityItemDto;
import com.workflowai.dashboard.DTO.CreateMilestoneRequest;
import com.workflowai.dashboard.DTO.DashboardAiJobResponse;
import com.workflowai.dashboard.DTO.DashboardTaskDto;
import com.workflowai.dashboard.DTO.DashboardSummaryResponse;
import com.workflowai.dashboard.DTO.DelayRiskDto;
import com.workflowai.dashboard.DTO.MilestoneProgressDto;
import com.workflowai.dashboard.DTO.ProgressDetailResponse;
import com.workflowai.dashboard.DTO.UpdateMilestoneRequest;
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
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<DashboardSummaryResponse> getSummary(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getSummary(projectId));
    }

    @Operation(summary = "대시보드 업무 목록", description = "대시보드 상세 화면에서 사용하는 실제 업무 목록을 반환한다.")
    @GetMapping("/tasks")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<DashboardTaskDto>> getTasks(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getTasks(projectId));
    }

    @Operation(summary = "대시보드 최근 활동", description = "프로젝트 최근 활동을 최신순으로 최대 50건 반환한다.")
    @GetMapping("/activities")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<ActivityItemDto>> getActivities(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getActivities(projectId));
    }

    @Operation(summary = "전체 진행률 상세", description = "마일스톤/카테고리별 진행률과 ML 지연 위험도(ml_predictions)를 반환한다.")
    @GetMapping("/progress")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<ProgressDetailResponse> getProgress(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.getProgressDetail(projectId));
    }

    @Operation(
        summary = "내 업무 지연 위험도",
        description = "현재 로그인한 사용자가 담당자인 업무 중 ML 지연 위험도가 '정상'이 아닌 업무 목록을 반환한다."
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
        description = "ML 업무 편중 점수 모델(ml_workload_score)의 마지막 계산 결과를 반환한다. "
            + "Redis에 캐시된 값이 있으면 그대로 반환하고, 이 프로젝트에서 아직 한 번도 계산한 적이 없으면 "
            + "그때만 FastAPI를 라이브로 호출해 캐시를 채운다. 최신 값이 필요하면 POST .../workload-score/refresh로 재계산을 요청한다."
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

    @Operation(
        summary = "업무 편중 점수 재계산 요청",
        description = "Redis Queue(dashboard-ai-jobs)에 편중 점수 재계산 작업을 적재하고 즉시 처리중 상태를 반환한다. "
            + "실제 계산은 DashboardAiQueueWorker가 비동기로 수행하며, 완료되면 팀원에게 알림이 가고 GET .../workload-score 캐시가 갱신된다."
    )
    @PostMapping("/workload-score/refresh")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<DashboardAiJobResponse> refreshWorkloadScore(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.enqueueWorkloadScoreRefresh(projectId, CurrentUser.id()));
    }

    @Operation(
        summary = "업무 편중 점수 재계산 상태 조회",
        description = "POST .../workload-score/refresh로 받은 jobId로 아직 처리 중인지(PROCESSING) 끝났는지(DONE) 확인한다. "
            + "DONE이면 GET .../workload-score를 다시 호출해 최신 결과를 가져온다."
    )
    @GetMapping("/workload-score/refresh/{jobId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<DashboardAiJobResponse> getWorkloadScoreRefreshStatus(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "재계산 작업 ID") @PathVariable String jobId
    ) {
        return ApiResponse.ok(dashboardService.getWorkloadScoreRefreshStatus(projectId, jobId));
    }

    @Operation(summary = "마일스톤 생성", description = "프로젝트에 새 마일스톤을 추가한다. 팀장만 생성할 수 있다.")
    @PostMapping("/milestones")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<MilestoneProgressDto> createMilestone(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Valid @RequestBody CreateMilestoneRequest request
    ) {
        return ApiResponse.ok(dashboardService.createMilestone(projectId, request.title(), request.startDate(), request.dueDate()));
    }

    @Operation(summary = "마일스톤 수정", description = "마일스톤의 이름/시작일/마감일을 수정한다. 팀장만 수정할 수 있다.")
    @PatchMapping("/milestones/{milestoneId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<MilestoneProgressDto> updateMilestone(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "마일스톤 ID") @PathVariable Long milestoneId,
        @Valid @RequestBody UpdateMilestoneRequest request
    ) {
        return ApiResponse.ok(dashboardService.updateMilestone(projectId, milestoneId, request.title(), request.startDate(), request.dueDate()));
    }

    @Operation(summary = "마일스톤 삭제", description = "마일스톤을 삭제한다. 연결된 업무는 삭제되지 않고 마일스톤 연결만 해제된다. 팀장만 삭제할 수 있다.")
    @DeleteMapping("/milestones/{milestoneId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<Void> deleteMilestone(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "마일스톤 ID") @PathVariable Long milestoneId
    ) {
        dashboardService.deleteMilestone(projectId, milestoneId);
        return ApiResponse.ok(null);
    }

    @Operation(
        summary = "ML 지연 위험도 재분석 요청",
        description = "Redis Queue(dashboard-ai-jobs)에 재분석 작업을 적재하고 즉시 처리중 상태를 반환한다. "
            + "실제 FastAPI(ml_delay_risk) 재예측과 ml_predictions 갱신은 DashboardAiQueueWorker가 비동기로 수행하며, "
            + "완료되면 팀원에게 알림이 간다. 같은 프로젝트에 대한 재분석이 이미 진행 중이면 새로 적재하지 않고 "
            + "기존 작업의 jobId를 그대로 돌려준다(중복 요청 병합). 프론트는 jobId로 상태 조회 후 진행률 상세를 다시 불러온다."
    )
    @PostMapping("/delay-risk/refresh")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<DashboardAiJobResponse> refreshDelayRisk(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(dashboardService.enqueueDelayRiskRefresh(projectId, CurrentUser.id()));
    }

    @Operation(
        summary = "ML 지연 위험도 재분석 상태 조회",
        description = "POST .../delay-risk/refresh로 받은 jobId로 아직 처리 중인지(PROCESSING) 끝났는지(DONE) 확인한다. "
            + "DONE이면 GET .../progress를 다시 호출해 최신 결과를 가져온다."
    )
    @GetMapping("/delay-risk/refresh/{jobId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<DashboardAiJobResponse> getDelayRiskRefreshStatus(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "재분석 작업 ID") @PathVariable String jobId
    ) {
        return ApiResponse.ok(dashboardService.getDelayRiskRefreshStatus(projectId, jobId));
    }
}
