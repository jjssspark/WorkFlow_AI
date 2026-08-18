package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmDto(
    @NotBlank(message = "재설정 링크가 올바르지 않습니다.")
    @Schema(description = "메일 링크의 token 쿼리 파라미터 값")
    String token,

    // 실제 상한은 UTF-8 72바이트(bcrypt 한계)라 PasswordPolicy가 바이트로 본다. 여기 글자 수 상한은
    // 그보다 느슨한 페이로드 방어선일 뿐이라, 문구는 바이트 기준 안내와 어긋나지 않게 맞춘다.
    // min과 max를 한 @Size에 묶으면 메시지가 하나뿐이라 짧은 입력에도 "너무 깁니다"가 나간다. 나눠 쓴다.
    @NotBlank(message = "비밀번호를 입력해주세요.")
    @Size(min = 8, message = "비밀번호는 8자 이상으로 입력해주세요.")
    @Size(max = 72, message = "비밀번호가 너무 깁니다. 영문·숫자는 72자, 한글은 24자까지 쓸 수 있습니다.")
    @Schema(description = "새 비밀번호 (8자 이상, UTF-8 72바이트 이하)", example = "newPassword123")
    String newPassword
) {
}
