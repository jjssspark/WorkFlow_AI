package com.workflowai.meeting;

/** requestedBy: 이 분석 실행을 트리거한 사용자 id. 원본 업로더와 다를 수 있다(예: 재시도/재분석을 다른 사람이 누른 경우). */
public record MeetingAnalysisJob(String jobId, Long meetingId, AiAnalyzeRequest request, Long requestedBy) {}
