package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "마일스톤 진행 현황 (연결된 업무의 완료 비율로 계산)")
public record MilestoneProgressDto(
    @Schema(description = "마일스톤 ID", example = "3") String id,
    @Schema(description = "마일스톤 이름", example = "핵심 기능 개발") String title,
    @Schema(description = "시작일 (YYYY-MM-DD, 미입력 시 null)", example = "2026-06-01") String startDate,
    @Schema(description = "마감일 (YYYY-MM-DD)", example = "2026-07-10") String dueDate,
    @Schema(description = "상태 (done/inprogress/todo)", example = "inprogress") String status,
    @Schema(description = "연결된 업무 수", example = "6") long taskCount,
    @Schema(description = "완료된 업무 수", example = "3") long doneCount,
    @Schema(description = "진행률 (%)", example = "50") long progressPercent,
    @Schema(description = "생성일(ISO datetime) — startDate가 없는 과거 마일스톤의 일정표 시작일 근사치로만 쓴다", example = "2026-06-01T09:00:00") String createdAt,
    @Schema(description = "이 마일스톤(task.milestoneId)에 연결된 업무 ID 목록") List<String> taskIds
) {
}
