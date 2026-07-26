package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "대시보드 업무 목록 항목")
public record DashboardTaskDto(
    @Schema(description = "업무 ID", example = "42") String id,
    @Schema(description = "업무 제목", example = "발표자료 초안 작성") String title,
    @Schema(description = "카테고리", example = "presentation") String category,
    @Schema(description = "상태", example = "inprogress") String status,
    @Schema(description = "담당자 ID", example = "1") String assigneeId,
    @Schema(description = "담당자 이름", example = "김민준") String assigneeName,
    @Schema(description = "마감일(YYYY-MM-DD)", example = "2026-07-21") String dueDate,
    @Schema(description = "우선순위", example = "high") String priority,
    @Schema(description = "업무 설명") String description,
    @Schema(description = "업무 생성 출처", example = "MEETING_AI") String sourceType,
    @Schema(description = "같은 상태 안에서의 칸반 카드 순서", example = "0.0") double position,
    @Schema(description = "업무 생성 시각(ISO-8601)", example = "2026-07-01T09:00:00") String createdAt,
    @Schema(description = "업무 마지막 수정 시각(ISO-8601)", example = "2026-07-19T15:30:00") String updatedAt
) {
}
