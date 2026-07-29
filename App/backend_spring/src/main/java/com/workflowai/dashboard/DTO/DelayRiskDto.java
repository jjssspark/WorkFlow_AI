package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "업무별 ML 지연 위험도 (ml_predictions 최신 행 기준)")
public record DelayRiskDto(
    @Schema(description = "업무 ID", example = "5") String taskId,
    @Schema(description = "업무 제목", example = "결제 시스템 연동") String taskTitle,
    @Schema(description = "담당자 이름", example = "최동혁") String assigneeName,
    @Schema(description = "업무 상태", example = "inprogress") String status,
    @Schema(description = "마감일 (YYYY-MM-DD)", example = "2026-07-21") String dueDate,
    @Schema(description = "위험도 (정상/주의/위험)", example = "위험") String result,
    @Schema(description = "모델 확신도 (0~1)", example = "0.82") Double score,
    @Schema(description = "예측 시각 (ISO-8601)", example = "2026-07-19T09:00:00") String predictedAt
) {
}
