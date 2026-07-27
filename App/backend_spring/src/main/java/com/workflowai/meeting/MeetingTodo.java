package com.workflowai.meeting;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "회의록 AI가 생성한 To-Do 후보")
public record MeetingTodo(
    @Schema(description = "업무 제목", example = "발표자료 초안 작성") String title,
    @Schema(description = "업무 설명", example = "회의에서 논의된 발표자료 목차를 기반으로 초안을 작성한다.") String description,
    @Schema(description = "AI가 추정한 담당자 후보 이름", example = "김민준") String assignee_candidate,
    @Schema(description = "담당자 ID (배정된 경우)", example = "1") String assignee_id,
    @Schema(description = "시작일 (YYYY-MM-DD 또는 MM/DD)", example = "2026-07-10") String start_date,
    @Schema(description = "마감일 (YYYY-MM-DD 또는 MM/DD)", example = "2026-07-15") String due_date,
    @Schema(description = "우선순위", example = "HIGH", allowableValues = {"HIGH", "MEDIUM", "LOW"}) String priority,
    @Schema(description = "카테고리", example = "PRESENTATION") String category,
    @Schema(description = "팀장 검토가 필요한지 여부 (담당자 미배정 등)", example = "false") boolean needs_leader_review,
    @Schema(description = "이 업무의 근거가 된 회의록 원문 발언/문장", example = "박지수: 저는 회의록 AI 분석을 맡겠습니다.") String evidence_text
) {
    /** start_date가 없던 기존 호출부와의 호환을 위한 보조 생성자 (시작일 없음으로 처리). */
    public MeetingTodo(
        String title,
        String description,
        String assignee_candidate,
        String assignee_id,
        String due_date,
        String priority,
        String category,
        boolean needs_leader_review,
        String evidence_text
    ) {
        this(title, description, assignee_candidate, assignee_id, null, due_date, priority, category, needs_leader_review, evidence_text);
    }

    /** evidence_text가 없던 기존 호출부와의 호환을 위한 보조 생성자 (근거 없음으로 처리). */
    public MeetingTodo(
        String title,
        String description,
        String assignee_candidate,
        String assignee_id,
        String due_date,
        String priority,
        String category,
        boolean needs_leader_review
    ) {
        this(title, description, assignee_candidate, assignee_id, null, due_date, priority, category, needs_leader_review, "");
    }
}
