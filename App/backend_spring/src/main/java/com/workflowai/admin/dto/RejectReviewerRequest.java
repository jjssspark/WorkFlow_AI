package com.workflowai.admin.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RejectReviewerRequest(
    @NotBlank(message = "거부 사유를 입력해주세요.")
    @Size(max = 500, message = "거부 사유는 500자 이하로 입력해주세요.")
    @Schema(description = "거부 사유", example = "교수 식별번호를 다시 확인해주세요.")
    String reason
) {
}
