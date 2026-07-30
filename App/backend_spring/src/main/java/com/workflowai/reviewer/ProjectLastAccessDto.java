package com.workflowai.reviewer;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "심사자 홈 배정 프로젝트 목록의 최근 접속순 정렬용 항목")
public record ProjectLastAccessDto(
    @Schema(description = "프로젝트 ID", example = "1") Long projectId,
    @Schema(description = "마지막 접속 시각 (ISO-8601 UTC)") String lastAccessedAt
) {}
