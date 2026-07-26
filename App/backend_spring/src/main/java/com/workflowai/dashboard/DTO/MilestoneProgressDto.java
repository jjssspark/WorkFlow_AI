package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "마일스톤 진행 현황 (연결된 업무의 완료 비율로 계산)")
public record MilestoneProgressDto(
    @Schema(description = "마일스톤 ID", example = "3") String id,
    @Schema(description = "마일스톤 이름", example = "핵심 기능 개발") String title,
    @Schema(description = "시작일 (YYYY-MM-DD)", example = "2026-07-01") String startDate,
    @Schema(description = "마감일 (YYYY-MM-DD)", example = "2026-07-10") String dueDate,
    @Schema(description = "상태 (done/inprogress/todo)", example = "inprogress") String status,
    @Schema(description = "연결된 업무 수", example = "6") long taskCount,
    @Schema(description = "완료된 업무 수", example = "3") long doneCount,
    @Schema(description = "진행률 (%)", example = "50") long progressPercent
) {
}
