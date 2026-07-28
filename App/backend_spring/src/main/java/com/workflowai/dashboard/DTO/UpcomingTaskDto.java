package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "마감 임박 업무")
public record UpcomingTaskDto(
    @Schema(description = "업무 ID", example = "5") String id,
    @Schema(description = "업무 제목", example = "결제 시스템 연동") String title,
    @Schema(description = "상태", example = "inprogress") String status,
    @Schema(description = "마감일 (YYYY-MM-DD)", example = "2026-07-21") String dueDate,
    @Schema(description = "담당자 ID (미배정이면 null)", example = "5") String assigneeId,
    @Schema(description = "담당자 이름 (미배정이면 null)", example = "최동혁") String assigneeName
) {
}
