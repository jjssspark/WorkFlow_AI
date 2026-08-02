package com.workflowai.meeting;

import java.util.List;

public record AiAnalyzeRequest(
    String project_id,
    String title,
    String meeting_date,
    String meeting_kind,
    String source_type,
    String file_name,
    String text,
    List<String> participants,
    /** 서비스 양식으로 작성된 문서일 때만 채워진다. 양식 미인식 문서와 음성 업로드는 null. */
    MeetingSections sections
) {
    /** 섹션 정보 없이 분석을 요청하는 기존 경로용(양식 미인식 문서, 음성 업로드, 재분석). */
    public AiAnalyzeRequest(
        String project_id,
        String title,
        String meeting_date,
        String meeting_kind,
        String source_type,
        String file_name,
        String text,
        List<String> participants
    ) {
        this(project_id, title, meeting_date, meeting_kind, source_type, file_name, text, participants, null);
    }
}
