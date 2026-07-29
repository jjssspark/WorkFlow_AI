package com.workflowai.dashboard.DTO;

import java.util.List;

public record WorkloadScoreResponseDto(
    String schema_version,
    Long project_id,
    String source,
    String method,
    List<WorkloadScoreMemberDto> members,
    String note,
    Double team_mean_completion,
    /** 이 결과를 실제로 계산한 시각(ISO-8601 UTC). GET /workload-score는 마지막 계산 결과를
     * 캐시에서 돌려주므로, 화면이 "언제 기준 값인지" 알 수 있어야 한다. FastAPI 응답에는 없는
     * 필드로, Spring이 캐시에 넣는 시점에 채운다(캐시에 없던 옛 항목은 null). */
    String calculated_at
) {
    public WorkloadScoreResponseDto withCalculatedAt(String calculatedAt) {
        return new WorkloadScoreResponseDto(
            schema_version, project_id, source, method, members, note, team_mean_completion, calculatedAt
        );
    }
}
