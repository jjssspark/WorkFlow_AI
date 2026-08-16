package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

class AuthRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void signupRequest_rejectsInvalidEmail() {
        SignupRequest request = new SignupRequest("not-an-email", "12345678", "홍길동", "MEMBER", true, true, null, null);

        assertThat(validator.validate(request)).isNotEmpty();
    }

    @Test
    void signupRequest_rejectsInvalidRoleType() {
        SignupRequest request = new SignupRequest("user@example.com", "12345678", "홍길동", "ADMIN", true, true, null, null);

        assertThat(validator.validate(request)).isNotEmpty();
    }

    @Test
    void signupRequest_acceptsReviewerApplication() {
        SignupRequest request = new SignupRequest(
            "prof@example.com", "12345678", "고교수", "REVIEWER", true, true, "컴퓨터공학과", "PROF-2026-001"
        );

        assertThat(validator.validate(request)).isEmpty();
    }

    /**
     * DTO의 @Size는 min과 max에 메시지를 하나만 쓴다. 그래서 문구를 "너무 깁니다" 한쪽으로 맞추면
     * 짧은 비밀번호를 넣은 사용자가 정반대 안내를 받는다. 컨트롤러의 @Valid가 서비스보다 먼저 돌기
     * 때문에 PasswordPolicy의 올바른 최소 길이 문구는 HTTP로는 도달하지 못한다.
     */
    private String firstMessage(Object request) {
        return validator.validate(request).iterator().next().getMessage();
    }

    @Test
    void signupRequest_shortPassword_saysTooShortNotTooLong() {
        SignupRequest request = new SignupRequest(
            "user@example.com", "1234", "홍길동", "MEMBER", true, true, null, null);

        assertThat(firstMessage(request)).contains("8자 이상").doesNotContain("너무 깁니다");
    }

    @Test
    void signupRequest_longPassword_saysTooLong() {
        SignupRequest request = new SignupRequest(
            "user@example.com", "a".repeat(73), "홍길동", "MEMBER", true, true, null, null);

        assertThat(firstMessage(request)).contains("너무 깁니다");
    }

    /**
     * 한글 25자는 75바이트지만 글자 수로는 25자라 @Size를 통과한다. 바이트 상한을 실제로 지키는 건
     * PasswordPolicy다 — 이 계층 분담이 깨지면 다시 500이 난다.
     */
    @Test
    void signupRequest_koreanPasswordOver72Bytes_passesDtoAndIsLeftToPasswordPolicy() {
        SignupRequest request = new SignupRequest(
            "user@example.com", "가".repeat(25), "홍길동", "MEMBER", true, true, null, null);

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void passwordResetConfirmDto_shortPassword_saysTooShortNotTooLong() {
        PasswordResetConfirmDto request = new PasswordResetConfirmDto("token", "1234");

        assertThat(firstMessage(request)).contains("8자 이상").doesNotContain("너무 깁니다");
    }

    @Test
    void passwordResetConfirmDto_longPassword_saysTooLong() {
        PasswordResetConfirmDto request = new PasswordResetConfirmDto("token", "a".repeat(73));

        assertThat(firstMessage(request)).contains("너무 깁니다");
    }

    @Test
    void passwordChangeRequest_shortNewPassword_saysTooShortNotTooLong() {
        PasswordChangeRequest request = new PasswordChangeRequest("current-password", "1234");

        assertThat(firstMessage(request)).contains("8자 이상").doesNotContain("너무 깁니다");
    }

    @Test
    void passwordChangeRequest_longNewPassword_saysTooLong() {
        PasswordChangeRequest request = new PasswordChangeRequest("current-password", "a".repeat(73));

        assertThat(firstMessage(request)).contains("너무 깁니다");
    }

    @Test
    void loginRequest_rejectsBlankPassword() {
        LoginRequest request = new LoginRequest("user@example.com", "");

        assertThat(validator.validate(request)).isNotEmpty();
    }
}
