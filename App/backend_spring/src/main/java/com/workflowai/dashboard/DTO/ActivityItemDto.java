package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "최근 활동 항목")
public record ActivityItemDto(
    @Schema(description = "활동 ID", example = "12") String id,
    @Schema(description = "활동 유형 (업무 변경/GitHub/회의록/산출물 등)", example = "TASK_UPDATE") String type,
    @Schema(description = "행위자 이름", example = "김민준") String actorName,
    @Schema(description = "화면에 표시할 메시지") String message,
    @Schema(description = "대상 id (폴리모픽, 유형에 따라 다름)", example = "5") String targetId,
    @Schema(description = "발생 시각 (ISO-8601)", example = "2026-07-19T10:15:00") String createdAt
) {
}
