package com.workflowai.project;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

@Schema(description = "프로젝트 상세 정보 (참여 인원 수/업무 진행률은 실제 DB 데이터로 계산됨)")
public record ProjectResponse(
    Long id,
    String title,
    String type,
    LocalDate deadline,
    String description,
    LocalDate startDate,
    LocalDate midCheckDate,
    Integer memberLimit,
    List<String> deliverables,
    List<String> techStack,
    String goals,
    String inviteCode,
    Long createdBy,
    @Schema(description = "project_members 실제 인원 수") int memberCount,
    @Schema(description = "tasks 완료율(%). 업무가 하나도 없으면 0") int taskProgress,
    @Schema(description = "평가 진행 상태(PENDING/EVALUATING/PUBLISHED)") String evalStatus
) {
}
