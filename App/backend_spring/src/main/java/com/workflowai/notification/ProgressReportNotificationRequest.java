package com.workflowai.notification;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "AI 진행률 보고서 생성 완료 알림 요청")
public record ProgressReportNotificationRequest(
    @Schema(description = "알림 본문 (예: 완료율/지연 위험 요약)", example = "전체 완료율 62%, 지연 위험 업무 3개") String content
) {}
