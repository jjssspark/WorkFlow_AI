package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmDto(
    @NotBlank(message = "재설정 링크가 올바르지 않습니다.")
    @Schema(description = "메일 링크의 token 쿼리 파라미터 값")
    String token,

    @NotBlank(message = "비밀번호를 입력해주세요.")
    @Size(min = 8, max = 128, message = "비밀번호는 8자 이상 128자 이하로 입력해주세요.")
    @Schema(description = "새 비밀번호 (8자 이상)", example = "newPassword123")
    String newPassword
) {
}
