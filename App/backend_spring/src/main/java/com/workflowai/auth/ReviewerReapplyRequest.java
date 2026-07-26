package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ReviewerReapplyRequest(
    @NotBlank(message = "이메일을 입력해주세요.")
    @Email(message = "올바른 이메일 형식으로 입력해주세요.")
    @Size(max = 255, message = "이메일은 255자 이하로 입력해주세요.")
    @Schema(description = "가입 시 사용한 이메일", example = "prof@example.com")
    String email,

    @NotBlank(message = "비밀번호를 입력해주세요.")
    @Schema(description = "비밀번호 (본인 확인용)")
    String password,

    @Size(max = 100, message = "소속은 100자 이하로 입력해주세요.")
    @Schema(description = "소속기관 또는 학과", example = "컴퓨터공학과")
    String affiliation,

    @Size(max = 50, message = "교수 식별번호는 50자 이하로 입력해주세요.")
    @Schema(description = "교수/교직원 식별번호", example = "PROF-2026-001")
    String facultyId
) {
}
