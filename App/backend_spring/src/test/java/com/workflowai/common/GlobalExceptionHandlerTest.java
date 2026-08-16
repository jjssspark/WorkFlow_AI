package com.workflowai.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new SampleController())
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void oversizedUploadReturnsFileTooLargeEnvelope() {
        var response = new GlobalExceptionHandler().handleMaxUploadSizeExceeded(
            new org.springframework.web.multipart.MaxUploadSizeExceededException(100L * 1024 * 1024)
        );

        org.assertj.core.api.Assertions.assertThat(response.getStatusCode().value()).isEqualTo(413);
        org.assertj.core.api.Assertions.assertThat(response.getBody().success()).isFalse();
        org.assertj.core.api.Assertions.assertThat(response.getBody().error().code()).isEqualTo("FILE_TOO_LARGE");
    }

    /**
     * 잠금 실패를 교착과 구분하려면 원인 사슬의 SQLState를 훑어야 하는데, 그 사슬은 순환할 수 있다.
     * {@code Throwable.initCause}가 막는 것은 자기 자신을 원인으로 삼는 경우뿐이라 아래처럼 두
     * 예외가 서로를 가리키는 형태는 아무 제약 없이 만들어진다. 사슬을 끝까지 훑는 코드가 이 모양을
     * 만나면 돌아오지 않는다.
     *
     * <p>핸들러를 직접 부른다. MockMvc로 태우면 Spring의 {@code ExceptionHandlerMethodResolver}가
     * 핸들러를 고르기도 전에 같은 사슬을 재귀로 훑다 StackOverflowError로 죽어서, 여기서 보려는
     * 우리 쪽 순회가 가려진다. 순환 사슬을 프레임워크가 견디게 하는 것은 이 층에서 할 수 있는 일이
     * 아니고, 이 테스트가 지키는 것도 그게 아니다 — 우리 순회가 끝난다는 것만 본다.
     */
    @Test
    void cyclicCauseChainDoesNotTrapTheLockFailureHandler() {
        var first = new java.sql.SQLException("first", "55P03");
        var second = new java.sql.SQLException("second", "55P03");
        first.initCause(second);
        second.initCause(first);

        var response = org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
            java.time.Duration.ofSeconds(5),
            () -> new GlobalExceptionHandler().handleLockFailure(
                new org.springframework.dao.CannotAcquireLockException("cyclic cause chain", first)),
            "원인 사슬을 훑다 순환에 갇혔다 - 요청 스레드가 돌아오지 않는다");

        org.assertj.core.api.Assertions.assertThat(response.getStatusCode().value()).isEqualTo(503);
        org.assertj.core.api.Assertions.assertThat(response.getBody().error().code()).isEqualTo("RESOURCE_BUSY");
    }

    @Test
    void missingRequiredFieldReturnsCommonInvalidRequestEnvelope() throws Exception {
        mockMvc.perform(post("/test-validation")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.data").doesNotExist())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
            .andExpect(jsonPath("$.error.message").isNotEmpty());
    }

    @RestController
    static class SampleController {
        @PostMapping("/test-validation")
        public void handle(@Valid @RequestBody SampleRequest request) {
        }
    }

    static class SampleRequest {
        @NotBlank
        private String name;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }
    }
}
