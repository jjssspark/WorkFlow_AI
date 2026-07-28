package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "대시보드 ML 재분석 작업 응답 (Redis Queue 적재/상태 조회 공용)")
public record DashboardAiJobResponse(
    @Schema(description = "작업 ID", example = "3f6a9e2e-0e9b-4b8b-9b7a-6b7e7a8f9c1d") String jobId,
    @Schema(description = "프로젝트 ID", example = "demo-project") String projectId,
    @Schema(description = "작업 종류", example = "DELAY_RISK", allowableValues = {"DELAY_RISK", "WORKLOAD_SCORE"}) String jobType,
    @Schema(description = "작업 상태", example = "PROCESSING", allowableValues = {"PROCESSING", "DONE", "FAILED"}) String status
) {
}
