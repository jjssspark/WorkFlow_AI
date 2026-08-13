package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record FindEmailRequest(
    @NotBlank(message = "이름을 입력해주세요.")
    @Size(max = 100, message = "이름은 100자 이하로 입력해주세요.")
    @Schema(description = "가입 시 등록한 이름", example = "홍길동")
    String name,

    @NotBlank(message = "소속을 입력해주세요.")
    @Size(max = 100, message = "소속은 100자 이하로 입력해주세요.")
    @Schema(description = "가입 시 등록한 소속", example = "컴퓨터공학과")
    String affiliation
) {
}
