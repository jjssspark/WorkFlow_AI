package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.workflowai.common.GlobalExceptionHandler;
import com.workflowai.presence.PresenceService;
import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 행 잠금 실패가 어떤 응답과 어떤 로그로 나가는지 고정한다.
 *
 * <p>세션 폐기를 원자적으로 만들려고 사용자 행에 잠금을 걸면서, 잠금을 못 잡는 경로가 새로
 * 생겼다. 여기서 보는 것은 두 가지다.
 *
 * <ol>
 *   <li><strong>대기 상한에 걸린 경우</strong>는 서버 결함이 아니라 "같은 계정이 지금 바쁘다"는
 *       뜻이므로 500이 아니라 503으로 나가야 한다. 이 매핑이 사라지면 사용자는 장애 화면을 본다.
 *   <li><strong>교착</strong>은 잠금 순서가 어긋났다는 뜻이라 코드 결함이다. 앞의 것과 같은
 *       WARN으로 흘려보내면 "잠깐 붐볐다"와 구분되지 않아 조용히 묻힌다. 응답은 같아도(클라이언트
 *       입장에선 똑같이 재시도할 일이다) 로그는 ERROR로 남아야 사람이 알아챈다.
 * </ol>
 */
@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = "workflow.frontend.base-url=http://localhost:5173")
class LockFailureResponseTest {

    /** PostgreSQL lock_not_available - 대기 상한에 걸린 경우. */
    private static final String SQLSTATE_LOCK_TIMEOUT = "55P03";
    /** PostgreSQL deadlock_detected. */
    private static final String SQLSTATE_DEADLOCK = "40P01";

    @Autowired private MockMvc mockMvc;

    @MockitoBean private GoogleOAuthService googleOAuthService;
    @MockitoBean private AuthService authService;
    @MockitoBean private TestLoginService testLoginService;
    @MockitoBean private PresenceService presenceService;
    @MockitoBean private AccountRecoveryService accountRecoveryService;
    @MockitoBean private PasswordResetService passwordResetService;
    @MockitoBean private AccountRecoveryRateLimiter rateLimiter;

    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private Logger handlerLogger;

    @BeforeEach
    void setUp() {
        // 여기서 보려는 건 한도가 아니라 잠금 실패 응답이므로 레이트리밋은 통과시킨다.
        when(rateLimiter.tryAcquire(anyString(), anyString(), ArgumentMatchers.anyInt(),
            ArgumentMatchers.any())).thenReturn(true);

        handlerLogger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
        logs.start();
        handlerLogger.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        handlerLogger.detachAppender(logs);
        logs.stop();
    }

    private void refreshExpecting503() throws Exception {
        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"valid-but-account-is-locked\"}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("RESOURCE_BUSY"))
            .andExpect(jsonPath("$.error.message").value("처리 중입니다. 잠시 후 다시 시도해주세요."));
    }

    /** Spring이 번역한 뒤에도 원인 사슬에 남는 형태 그대로 만든다. 구분 단서는 SQLState뿐이다. */
    private static CannotAcquireLockException lockFailure(String message, String sqlState) {
        return new CannotAcquireLockException(message, new SQLException(message, sqlState));
    }

    @Test
    @DisplayName("잠금 대기 상한에 걸리면 500이 아니라 503 RESOURCE_BUSY로 나간다")
    void lockTimeout_returnsServiceUnavailableNotServerError() throws Exception {
        when(authService.refresh(anyString()))
            .thenThrow(lockFailure("canceling statement due to lock timeout", SQLSTATE_LOCK_TIMEOUT));

        refreshExpecting503();

        assertThat(logs.list)
            .as("일상적인 경합까지 ERROR로 올리면 진짜 결함이 묻힌다")
            .noneSatisfy(event -> assertThat(event.getLevel()).isEqualTo(Level.ERROR));
    }

    @Test
    @DisplayName("교착은 같은 503으로 응답하되 WARN이 아니라 ERROR로 남아 묻히지 않는다")
    void deadlock_isLoggedAsErrorSoItIsNotHiddenAsRoutineContention() throws Exception {
        when(authService.refresh(anyString()))
            .thenThrow(lockFailure("deadlock detected", SQLSTATE_DEADLOCK));

        refreshExpecting503();

        assertThat(logs.list)
            .as("교착은 잠금 순서 결함이다. 일상적인 경합과 같은 레벨로 흘리면 알아챌 방법이 없다")
            .anySatisfy(event -> assertThat(event.getLevel()).isEqualTo(Level.ERROR));
    }
}
