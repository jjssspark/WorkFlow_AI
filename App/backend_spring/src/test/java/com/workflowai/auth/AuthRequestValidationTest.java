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

    @Test
    void loginRequest_rejectsBlankPassword() {
        LoginRequest request = new LoginRequest("user@example.com", "");

        assertThat(validator.validate(request)).isNotEmpty();
    }
}
