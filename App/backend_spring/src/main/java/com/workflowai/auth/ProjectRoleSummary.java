package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "사용자가 속한 프로젝트와 해당 프로젝트에서의 역할")
public record ProjectRoleSummary(
    Long projectId,
    String projectTitle,
    String role,
    String type,
    Integer year,
    int taskProgress
) {
}
