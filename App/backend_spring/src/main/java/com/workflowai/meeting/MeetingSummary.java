package com.workflowai.meeting;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "회의록 목록 항목")
public record MeetingSummary(
    @Schema(description = "회의록 ID", example = "12") String meetingId,
    @Schema(description = "회의 제목", example = "7차 정기회의") String title,
    @Schema(description = "회의 날짜", example = "2026-07-09") String meetingDate,
    @Schema(description = "회의 유형", example = "정기회의") String meetingType,
    @Schema(description = "분석 상태", example = "completed", allowableValues = {"pending", "processing", "completed", "failed"}) String analysisStatus,
    @Schema(description = "회의록 저장 확정 시각(미저장 시 null)", example = "2026-07-09T10:00:00") String savedAt,
    @Schema(description = "버전 생성 시 원본 회의록 ID(원본이면 null)", example = "11") String originalMeetingId,
    @Schema(description = "역할분배·업무보드 등록이 실제로 완료됐는지 여부", example = "true") boolean tasksRegistered,
    @Schema(description = "AI 분석이 To-Do 후보를 1건이라도 생성했는지 여부", example = "true") boolean hasGeneratedTodos
) {}
