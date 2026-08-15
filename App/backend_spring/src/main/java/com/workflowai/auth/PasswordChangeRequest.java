package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 대상 계정은 인증 주체에서만 나온다 — 요청 본문에 userId/email 같은 필드를 두지 않는다.
 * 남의 계정을 지정할 수 있는 구멍을 애초에 만들지 않기 위해서다.
 */
public record PasswordChangeRequest(
    // 길이 상한은 bcrypt 비교에 임의 크기 입력이 넘어가지 않게 막는다(LoginRequest와 같은 이유).
    // 최소 길이는 걸지 않는다 — 정책이 바뀌기 전에 만들어진 짧은 비밀번호를 쓰는 사람이
    // 자기 비밀번호를 바꾸지 못하게 되면 안 된다.
    @NotBlank(message = "현재 비밀번호를 입력해주세요.")
    @Size(max = 128, message = "비밀번호는 128자 이하로 입력해주세요.")
    @Schema(description = "본인 확인용 현재 비밀번호")
    String currentPassword,

    @NotBlank(message = "새 비밀번호를 입력해주세요.")
    @Size(min = 8, max = 128, message = "비밀번호는 8자 이상 128자 이하로 입력해주세요.")
    @Schema(description = "새 비밀번호 (8자 이상)", example = "newPassword123")
    String newPassword
) {
}
