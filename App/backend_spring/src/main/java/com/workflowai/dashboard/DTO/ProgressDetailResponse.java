package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "전체 진행률 상세")
public record ProgressDetailResponse(
    @Schema(description = "전체 업무 수", example = "14") long totalTasks,
    @Schema(description = "완료 업무 수", example = "4") long doneTasks,
    @Schema(description = "완료율 (%)", example = "29") long progressPercent,
    @Schema(description = "마일스톤별 진행 현황") List<MilestoneProgressDto> milestones,
    @Schema(description = "카테고리별 완료 현황") List<CategoryProgressDto> categoryBreakdown,
    @Schema(description = "ML 지연 위험도 (정상 제외, 주의/위험만)") List<DelayRiskDto> delayRisks,
    @Schema(description = "이 프로젝트에 대해 ML 지연 위험도 예측이 한 번이라도 실행됐는지 여부", example = "true")
    boolean hasPredictions,
    @Schema(description = "프로젝트 마감일 (YYYY-MM-DD)", example = "2026-08-15") String projectDeadline,
    @Schema(description = "프로젝트 생성일 (YYYY-MM-DD)", example = "2026-06-01") String projectCreatedAt
) {
}
