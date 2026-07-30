package com.workflowai.reviewer;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "심사자 홈 \"최근 심사 활동\" 위젯용 활동 항목")
public record ReviewerActivityDto(
    @Schema(description = "활동 ID", example = "12") String id,
    @Schema(description = "활동이 발생한 프로젝트명", example = "스마트 주차 관리 시스템") String projectTitle,
    @Schema(description = "화면에 그대로 보여줄 메시지") String message,
    @Schema(description = "발생 시각 (ISO-8601 UTC)") String createdAt
) {}
