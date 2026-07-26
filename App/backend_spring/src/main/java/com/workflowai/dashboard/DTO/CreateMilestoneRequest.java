package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;

@Schema(description = "마일스톤 생성 요청")
public record CreateMilestoneRequest(
    @Schema(example = "MVP 발표") @NotBlank String title,
    @Schema(description = "마감일 (선택)", example = "2026-08-15") LocalDate dueDate
) {
}
