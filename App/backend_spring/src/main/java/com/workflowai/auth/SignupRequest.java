package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SignupRequest(
    @NotBlank(message = "이메일을 입력해주세요.")
    @Email(message = "올바른 이메일 형식으로 입력해주세요.")
    @Size(max = 255, message = "이메일은 255자 이하로 입력해주세요.")
    @Schema(description = "이메일 (로그인 아이디로 사용)", example = "user@example.com")
    String email,

    // 실제 상한은 UTF-8 72바이트(bcrypt 한계)라 PasswordPolicy가 바이트로 본다. 여기 글자 수 상한은
    // 그보다 느슨한 페이로드 방어선일 뿐이라, 문구는 바이트 기준 안내와 어긋나지 않게 맞춘다.
    // min과 max를 한 @Size에 묶으면 메시지가 하나뿐이라 짧은 입력에도 "너무 깁니다"가 나간다. 나눠 쓴다.
    @NotBlank(message = "비밀번호를 입력해주세요.")
    @Size(min = 8, message = "비밀번호는 8자 이상으로 입력해주세요.")
    @Size(max = 72, message = "비밀번호가 너무 깁니다. 영문·숫자는 72자, 한글은 24자까지 쓸 수 있습니다.")
    @Schema(description = "비밀번호 (8자 이상, UTF-8 72바이트 이하)", example = "12345678")
    String password,

    @NotBlank(message = "이름을 입력해주세요.")
    @Size(max = 100, message = "이름은 100자 이하로 입력해주세요.")
    @Schema(description = "이름", example = "홍길동")
    String name,

    @Pattern(regexp = "(?i)^(MEMBER|REVIEWER)$", message = "가입 유형은 MEMBER 또는 REVIEWER만 선택할 수 있습니다.")
    @Schema(description = "가입 유형: MEMBER(일반 회원) 또는 REVIEWER(심사자, 승인 대기)", example = "MEMBER")
    String roleType,

    @Schema(description = "이용약관 동의 여부 (true가 아니면 가입 거부)", example = "true")
    Boolean termsAgreed,

    @Schema(description = "개인정보처리방침 동의 여부 (true가 아니면 가입 거부)", example = "true")
    Boolean privacyAgreed,

    @Size(max = 100, message = "소속은 100자 이하로 입력해주세요.")
    @Schema(description = "소속기관 또는 학과 (REVIEWER 신청 시 필수)", example = "컴퓨터공학과")
    String affiliation,

    @Size(max = 50, message = "교수 식별번호는 50자 이하로 입력해주세요.")
    @Schema(description = "교수/교직원 식별번호 (REVIEWER 신청 시 필수)", example = "PROF-2026-001")
    String facultyId
) {
}
