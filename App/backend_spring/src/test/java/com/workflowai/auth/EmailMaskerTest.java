package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class EmailMaskerTest {

    @ParameterizedTest
    @DisplayName("로컬 파트 앞 2자만 남기고 나머지를 가린다")
    @CsvSource({
        "kimchulsoo@gmail.com, ki********@gmail.com",
        "abc@naver.com,        ab*@naver.com",
        "ab@naver.com,         a*@naver.com",
        "a@naver.com,          a@naver.com",
        "user.name@sub.co.kr,  us*******@sub.co.kr"
    })
    void mask_variousLocalParts(String input, String expected) {
        assertThat(EmailMasker.mask(input)).isEqualTo(expected);
    }

    @ParameterizedTest
    @DisplayName("@가 없거나 비어 있으면 통째로 가린다")
    @CsvSource({
        "notanemail, ****",
        "@naver.com, ****"
    })
    void mask_malformed(String input, String expected) {
        assertThat(EmailMasker.mask(input)).isEqualTo(expected);
    }

    @org.junit.jupiter.api.Test
    @DisplayName("null이면 빈 문자열")
    void mask_null() {
        assertThat(EmailMasker.mask(null)).isEmpty();
    }
}
