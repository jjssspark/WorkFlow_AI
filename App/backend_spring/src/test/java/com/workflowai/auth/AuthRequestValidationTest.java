package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

class AuthRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void signupRequest_rejectsInvalidEmail() {
        SignupRequest request = new SignupRequest("not-an-email", "12345678", "홍길동", "MEMBER", true);

        assertThat(validator.validate(request)).isNotEmpty();
    }

    @Test
    void signupRequest_rejectsInvalidRoleType() {
        SignupRequest request = new SignupRequest("user@example.com", "12345678", "홍길동", "ADMIN", true);

        assertThat(validator.validate(request)).isNotEmpty();
    }

    @Test
    void signupRequest_acceptsReviewerApplication() {
        SignupRequest request = new SignupRequest("prof@example.com", "12345678", "고교수", "REVIEWER", true);

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void loginRequest_rejectsBlankPassword() {
        LoginRequest request = new LoginRequest("user@example.com", "");

        assertThat(validator.validate(request)).isNotEmpty();
    }
}
