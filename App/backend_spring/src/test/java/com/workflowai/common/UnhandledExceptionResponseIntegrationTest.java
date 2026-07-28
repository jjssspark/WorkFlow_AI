package com.workflowai.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.when;

import com.workflowai.auth.AuthService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * UT-010: 예상치 못한 서버 내부 예외가 실제 HTTP 응답에 스택트레이스·원본 예외 메시지를
 * 노출하지 않는지 확인한다.
 *
 * <p>{@link ErrorEnvelopeIntegrationTest}는 같은 시나리오를 MockMvc로 재현하지만, MockMvc는
 * 처리되지 않은 예외를 실제 HTTP 응답으로 바꾸지 않고 그대로 되던진다(그 클래스의 주석 참고).
 * 그래서 클라이언트가 실제로 받는 500 바디를 보려면 내장 서버를 띄우고 진짜 HTTP 요청을
 * 보내야 한다.
 *
 * <p>{@code /api/v1/auth/signup}을 쓰는 이유는 permitAll 경로라서다. 인증이 필요한 경로로
 * 시도하면 JWT를 함께 검증해야 해서 이 테스트의 관심사(예외 은닉)와 무관한 변수가 늘어난다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UnhandledExceptionResponseIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String SIGNUP_PATH = "/api/v1/auth/signup";
    private static final String LEAKED_SECRET = "db-password-should-never-leak";

    @Autowired
    private TestRestTemplate restTemplate;

    @MockitoBean
    private AuthService authService;

    @Test
    void unexpectedServerErrorHidesStackTraceAndInternalMessageFromClient() {
        when(authService.signup(
            anyString(), anyString(), anyString(), any(), anyBoolean(), anyBoolean(), any(), any()
        )).thenThrow(new RuntimeException(LEAKED_SECRET));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<String> request = new HttpEntity<>(
            "{\"email\":\"unhandled-exception@workflow.test\",\"password\":\"password123\",\"name\":\"예외 은닉 검증\"}",
            headers
        );

        ResponseEntity<String> response = restTemplate.exchange(SIGNUP_PATH, HttpMethod.POST, request, String.class);

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        String body = response.getBody() == null ? "" : response.getBody();
        assertThat(body).doesNotContain(LEAKED_SECRET);
        assertThat(body).doesNotContain("RuntimeException");
        assertThat(body).doesNotContain("at com.workflowai");
    }
}
