package com.workflowai.common;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.rag.FastApiRagClient;
import com.workflowai.rag.RagQueryRequest;
import com.workflowai.rag.RagQueryResponse;
import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * IT-002 전역 오류 응답 규격 연계.
 *
 * <p>클라이언트는 모든 실패 응답이 {@code {success:false, error:{code,message}}} 형태라고 가정하고
 * {@code error.code}로 분기한다. 그런데 이 형태를 만들어내는 주체가 한 곳이 아니다.
 *
 * <ul>
 *   <li>401 - SecurityConfig의 authenticationEntryPoint (필터 체인이 직접 응답을 씀)
 *   <li>403 - SecurityConfig의 accessDeniedHandler (ExceptionTranslationFilter 경유)
 *   <li>400 - GlobalExceptionHandler (@RestControllerAdvice, DispatcherServlet 안쪽)
 * </ul>
 *
 * <p>서로 다른 세 메커니즘이 같은 모양을 내야 하는데, 이건 각 조각을 따로 보는 단위 테스트로는
 * 확인할 수 없다. @WebMvcTest 슬라이스는 SecurityConfig를 아예 로드하지 않으므로 403 대역
 * ({@link testsupport.AccessDeniedEnvelopeAdvice})을 끼워 넣어 검증한다. 즉 운영에서 실제로
 * 403을 만드는 코드는 슬라이스 테스트로는 닿지 않는다.
 *
 * <p>이 테스트를 처음 작성했을 때는 그 403 대역이 {@code com.workflowai} 하위 다섯 패키지에
 * 최상위 클래스로 흩어져 있었다. @RestControllerAdvice는 @Component이고 @SpringBootTest는
 * 테스트 클래스패스까지 컴포넌트 스캔하므로, 대역이 통합 테스트의 실제 컨텍스트에도 등록됐다.
 * 그래서 이 테스트조차 운영 코드가 아니라 대역이 만든 403을 보고 있었다. 두 응답이 우연히
 * 똑같아서 겉으로는 통과했고, {@code SecurityConfig}의 403 코드를 바꿔도 초록불이었다.
 * 대역을 스캔 범위 밖(testsupport)으로 옮긴 뒤에야 이 테스트가 운영 경로를 검증하게 됐다.
 *
 * <p>컨트롤러를 둘 이상 쓰는 이유는 "우연히 한 컨트롤러만 맞는" 상황을 배제하기 위해서다.
 */
class ErrorEnvelopeIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String RAG_QUERY_PATH = "/api/v1/ai/rag/query";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    /** 500 경로 실측용. RagController는 RestClientException만 잡으므로 그 외 예외는 그대로 빠져나간다. */
    @MockitoBean
    private FastApiRagClient fastApiRagClient;

    private String accessToken;
    private long memberProjectId;
    private long strangerProjectId;

    @BeforeEach
    void seedMembership() {
        jdbcTemplate.update("DELETE FROM project_members WHERE user_id IN (SELECT id FROM users WHERE email = ?)",
            "envelope@workflow.test");
        jdbcTemplate.update("DELETE FROM projects WHERE title IN ('envelope-member', 'envelope-stranger')");
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", "envelope@workflow.test");

        User user = userRepository.save(
            new User("envelope@workflow.test", "규격 검증", "local", "envelope@workflow.test")
        );
        accessToken = jwtService.issueAccessToken(user);

        memberProjectId = insertProject("envelope-member", user.getId());
        strangerProjectId = insertProject("envelope-stranger", user.getId());
        // 멤버십은 한쪽에만 준다. 같은 사용자가 한 프로젝트에는 통과하고 다른 프로젝트에는 막혀야
        // 403이 "토큰이 없어서"가 아니라 "그 프로젝트의 멤버가 아니라서"임이 증명된다.
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'LEADER')",
            memberProjectId, user.getId()
        );
    }

    @Test
    void unauthenticatedRequestsGetTheSameEnvelopeAcrossControllers() throws Exception {
        expectEnvelope(ragQuery(strangerProjectId, "인증 없이 질문", null), 401, "UNAUTHORIZED");
        expectEnvelope(delayRiskMine(strangerProjectId, null), 401, "UNAUTHORIZED");
    }

    @Test
    void nonMemberRequestsGetTheSameEnvelopeAcrossControllers() throws Exception {
        // 이 경로가 이 테스트의 핵심이다. @PreAuthorize가 던진 AccessDeniedException이
        // ExceptionTranslationFilter를 거쳐 SecurityConfig.handleForbidden까지 도달해야 envelope이 나온다.
        expectEnvelope(ragQuery(strangerProjectId, "남의 프로젝트 질문", accessToken), 403, "FORBIDDEN");
        expectEnvelope(delayRiskMine(strangerProjectId, accessToken), 403, "FORBIDDEN");
    }

    @Test
    void validationFailureUsesTheSameEnvelope() throws Exception {
        // @Valid 실패는 GlobalExceptionHandler가 처리한다. 위 401·403과 달리 DispatcherServlet
        // 안쪽에서 만들어지는데, 밖에서 만들어진 응답과 모양이 같아야 한다.
        expectEnvelope(
            mockMvc.perform(post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"형식이아님\",\"password\":\"x\",\"name\":\"\"}")),
            400, "INVALID_REQUEST"
        );
    }

    @Test
    void memberPassesAuthorizationSoTheForbiddenCaseIsAboutMembershipNotTheToken() throws Exception {
        // 같은 토큰으로 멤버인 프로젝트에 요청하면 인가를 통과해야 한다. 통과하지 못하면
        // 위 403 테스트가 "인가 실패"가 아니라 "토큰이 아예 안 먹힘"을 본 것이 되어 무의미해진다.
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenReturn(new RagQueryResponse("답변", List.of()));

        ragQuery(memberProjectId, "내 프로젝트 질문", accessToken)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void unexpectedExceptionsEscapeEveryHandlerSoTheEnvelopeIsNotApplied() throws Exception {
        // 이건 바람직한 동작을 고정하는 테스트가 아니라 현재 상태를 기록하는 테스트다.
        //
        // GlobalExceptionHandler는 ProjectScheduleException, MaxUploadSizeExceededException,
        // MethodArgumentNotValidException 셋만 처리한다. @ExceptionHandler(Exception.class)는
        // 코드베이스 어디에도 없다. 그래서 예상 못 한 예외는 어떤 어드바이스에도 잡히지 않고
        // 그대로 빠져나가고, 실제 서블릿 컨테이너에서는 Spring Boot 기본 오류 JSON
        // (timestamp/status/error/path)이 나간다. success·error.code가 없는 응답이라
        // error.code로 분기하는 클라이언트는 500에서만 파싱이 깨진다.
        //
        // MockMvc는 처리되지 않은 예외를 응답으로 바꾸지 않고 그대로 되던진다. 예외가 밖으로
        // 나온다는 사실 자체가 "이 예외를 envelope으로 바꾸는 핸들러가 없다"는 증거다.
        // 전역 핸들러가 추가되면 이 테스트가 실패하므로, 그때 의도적으로 갱신하면 된다.
        when(fastApiRagClient.query(any(RagQueryRequest.class)))
            .thenThrow(new IllegalStateException("의도적으로 발생시킨 내부 오류"));

        assertThatThrownBy(() -> ragQuery(memberProjectId, "내부 오류 유발", accessToken))
            .hasRootCauseInstanceOf(IllegalStateException.class);
    }

    private ResultActions ragQuery(long projectId, String question, String token) throws Exception {
        var request = post(RAG_QUERY_PATH)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"project_id\":" + projectId + ",\"question\":\"" + question + "\"}");
        if (token != null) {
            request = request.header("Authorization", "Bearer " + token);
        }
        return mockMvc.perform(request);
    }

    private ResultActions delayRiskMine(long projectId, String token) throws Exception {
        var request = get("/api/v1/projects/{projectId}/dashboard/delay-risk/mine", String.valueOf(projectId));
        if (token != null) {
            request = request.header("Authorization", "Bearer " + token);
        }
        return mockMvc.perform(request);
    }

    private void expectEnvelope(ResultActions result, int expectedStatus, String expectedCode) throws Exception {
        result.andExpect(status().is(expectedStatus))
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.data").doesNotExist())
            .andExpect(jsonPath("$.error.code").value(expectedCode))
            .andExpect(jsonPath("$.error.message").isNotEmpty());
    }

    private long insertProject(String title, Long createdBy) {
        Long id = jdbcTemplate.queryForObject(
            "INSERT INTO projects (title, type, created_by) VALUES (?, 'team', ?) RETURNING id",
            Long.class, title, createdBy
        );
        if (id == null) {
            throw new IllegalStateException("프로젝트 생성 실패: " + title);
        }
        return id;
    }
}
