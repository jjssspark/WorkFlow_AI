package com.workflowai.meeting;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "AI 회의록 분석 결과 본문")
public record MeetingAnalysisResult(
    @Schema(description = "AI 회의 요약", example = "이번 회의에서는 발표자료 작성, 백엔드 API 연결, 테스트 일정이 논의되었습니다.") String summary,
    @Schema(description = "핵심 결정사항 목록") List<String> decisions,
    @Schema(description = "AI가 생성한 To-Do 후보 목록") List<MeetingTodo> todos,
    @Schema(description = "위험 요소 목록") List<String> risks,
    @Schema(description = "핵심 키워드 목록", example = "[\"발표자료\", \"API 연동\", \"테스트\"]") List<String> keywords,
    @Schema(description = "회의 메타 정보 (제목/날짜/참석자)") MeetingMeta meeting_meta,
    @Schema(
        description = "요약을 실제로 만든 분석 티어. analysisSource=FASTAPI 안에서도 hf→ollama→규칙 기반으로 강등될 수 있어, 이 값이 없으면 사용자가 받은 요약의 출처를 알 수 없다. 컬럼이 생기기 전에 저장된 분석은 unknown.",
        example = "huggingface",
        allowableValues = {"huggingface", "ollama", "rule_based", "spring_fallback", "unknown"}
    ) String analysis_provider
) {
    /** 티어를 알 수 없는 자리를 위한 생성자. */
    public MeetingAnalysisResult(
        String summary,
        List<String> decisions,
        List<MeetingTodo> todos,
        List<String> risks,
        List<String> keywords,
        MeetingMeta meeting_meta
    ) {
        this(summary, decisions, todos, risks, keywords, meeting_meta, "unknown");
    }
}
