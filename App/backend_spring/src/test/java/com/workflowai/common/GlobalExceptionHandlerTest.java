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
