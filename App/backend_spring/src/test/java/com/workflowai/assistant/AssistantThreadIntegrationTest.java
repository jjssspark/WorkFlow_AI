package com.workflowai.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.JwtService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.client.ResourceAccessException;

/**
 * IT-032(스프링 구간) 확인~실행 연계 / IT-033 스레드 소유권 격리 / IT-034 요청 제한·장애 응답.
 *
 * <p>기존 {@link AssistantControllerTest}는 standaloneSetup에 협력 객체를 전부 목으로 바꿔 돈다.
 * 그중 {@link AssistantThreadOwnership}이 목이라, 소유권 판정 결과를 테스트가 직접 정해주고 있다.
 *
 * <pre>
 * when(threadOwnership.isOwnedBy("thread-1", 5L)).thenReturn(false);  // 격리 테스트
 * when(threadOwnership.isOwnedBy("thread-1", 5L)).thenReturn(true);   // 통과 테스트
 * </pre>
 *
 * <p>실제 클래스는 Redis에 {@code assistant_thread:{id}} 키를 쓰고 읽는데 그 왕복은 실행되지 않는다.
 * 그래서 {@code remember()}가 쓰는 키와 {@code isOwnedBy()}가 읽는 키가 어긋나면 모든 정상 사용자가
 * 자기 요청을 재개하지 못하고 403을 받는다 - 어시스턴트 업무 조작이 통째로 죽는데 두 테스트는
 * 그대로 통과한다. 여기서는 실제 Redis를 붙여 command가 기록하고 resume이 조회하는 연결 자체를 본다.
 *
 * <p>또 하나, standaloneSetup은 {@code @PreAuthorize}를 적용하지 않는다. 보안 필터 체인과 메서드
 * 보안이 실제로 도는 환경에서 비멤버가 어떤 코드를 받는지는 이 테스트에서만 측정된다.
 *
 * <p>FastAPI 클라이언트는 목이다. 여기서 검증하는 것은 LangGraph의 동작이 아니라 스프링 구간의
 * 배선이기 때문이다. 그래프 자체는 FastAPI 쪽 테스트가 실제 컴파일된 그래프와 체크포인터로 덮는다.
 */
class AssistantThreadIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String COMMAND_PATH = "/api/v1/ai/assistant/command";
    private static final String RESUME_PATH = "/api/v1/ai/assistant/resume";
    private static final String STEP_ID = "0-step";

    // RagRateLimiter의 기본 한도. 초과 케이스를 만들려면 이보다 한 번 더 보내야 한다.
    private static final int RATE_LIMIT_PER_WINDOW = 10;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private FastApiAssistantClient fastApiAssistantClient;

    private String ownerToken;
    private String otherMemberToken;
    private String strangerToken;
    private long projectId;
    private long rateLimitProjectId;

    @BeforeEach
    void seedProjectAndMembers() {
        cleanUpPreviousRun();

        long ownerId = createUser("assistant-owner@workflow.test", "스레드 소유자");
        long otherMemberId = createUser("assistant-other@workflow.test", "같은 프로젝트 동료");
        long strangerId = createUser("assistant-stranger@workflow.test", "비멤버");

        ownerToken = issueToken(ownerId);
        otherMemberToken = issueToken(otherMemberId);
        strangerToken = issueToken(strangerId);

        projectId = insertProject("assistant-thread-main");
        // 요청 제한은 프로젝트 단위라, 한도를 소진시키는 테스트가 다른 테스트의 예산을 건드리지
        // 않도록 프로젝트를 분리한다. RagRateLimiter는 컨텍스트 수명 동안 살아 있는 싱글턴이다.
        rateLimitProjectId = insertProject("assistant-thread-ratelimit");

        // 소유권 격리를 보려면 둘 다 같은 프로젝트의 멤버여야 한다. 멤버십으로 갈리면
        // @PreAuthorize가 먼저 막아서 정작 스레드 소유권 검사에 도달하지 못한다.
        addMember(projectId, ownerId, "LEADER");
        addMember(projectId, otherMemberId, "MEMBER");
        addMember(rateLimitProjectId, ownerId, "LEADER");
    }

    @Test
    void anotherMemberCannotResumeTheThreadSomeoneElseWasIssued() throws Exception {
        // IT-033. thread_id는 응답에 그대로 실려 나가므로 남이 알아낼 수 있다고 가정해야 한다.
        String threadId = issueConfirmThreadTo(ownerToken, "it033-thread");

        resume(otherMemberToken, projectId, threadId)
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("THREAD_NOT_OWNED"));

        // 차단이 스프링에서 끝나야 한다. FastAPI까지 갔다가 거절당하는 구조라면 남의 그래프를
        // 재개시킬 수는 없더라도 체크포인터를 건드리게 된다.
        verify(fastApiAssistantClient, never()).resume(any());
    }

    @Test
    void theIssuedOwnerCanResumeAndTheDecisionIsForwardedUpstream() throws Exception {
        // IT-032 스프링 구간. 이 테스트가 이 클래스의 핵심이다. command가 실제 Redis에 기록한
        // 소유권을 resume이 실제로 읽어야만 통과한다 - 목으로는 절대 드러나지 않는 연결이다.
        String threadId = issueConfirmThreadTo(ownerToken, "it032-thread");
        when(fastApiAssistantClient.resume(any(FastApiAssistantResumeRequest.class)))
            .thenReturn(new AssistantResponse("done", "1개 작업을 완료했습니다.", List.of(), null, null));

        resume(ownerToken, projectId, threadId)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.type").value("done"));

        ArgumentCaptor<FastApiAssistantResumeRequest> captor =
            ArgumentCaptor.forClass(FastApiAssistantResumeRequest.class);
        verify(fastApiAssistantClient).resume(captor.capture());
        assertThat(captor.getValue().thread_id()).isEqualTo(threadId);
        assertThat(captor.getValue().step_id()).isEqualTo(STEP_ID);
        assertThat(captor.getValue().ok()).isTrue();
    }

    @Test
    void requestsBeyondTheProjectQuotaAreRejectedWithTheDocumentedCode() throws Exception {
        // IT-034 앞쪽. 한도 초과 응답을 검증하는 테스트가 지금까지 없었다.
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenReturn(new AssistantResponse("answer", "답변", List.of(), null, null));

        for (int attempt = 0; attempt < RATE_LIMIT_PER_WINDOW; attempt++) {
            command(ownerToken, rateLimitProjectId, "허용 범위 안의 질문").andExpect(status().isOk());
        }

        command(ownerToken, rateLimitProjectId, "한도를 넘는 질문")
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    @Test
    void downstreamFailureOnResumeIsReportedAsUnavailableNotAsAnInternalError() throws Exception {
        // IT-034 뒤쪽. command 경로의 503은 기존 단위 테스트가 덮지만 resume 경로는 비어 있었다.
        // 다운스트림 장애가 500으로 새면 "일시 장애"와 "코드 결함"이 뭉개진다.
        String threadId = issueConfirmThreadTo(ownerToken, "it034-thread");
        when(fastApiAssistantClient.resume(any(FastApiAssistantResumeRequest.class)))
            .thenThrow(new ResourceAccessException("connection refused"));

        resume(ownerToken, projectId, threadId)
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("ASSISTANT_UNAVAILABLE"));
    }

    @Test
    void nonMemberIsStoppedByMethodSecurityBeforeTheControllerSpecificCodeCanRun() throws Exception {
        // 바람직한 동작을 고정하는 테스트가 아니라 현재 상태를 기록하는 테스트다.
        //
        // AssistantController 본문에는 멤버십이 없을 때 NOT_PROJECT_MEMBER를 반환하는 분기가 있고
        // 단위 테스트도 그 코드를 검증한다. 그런데 메서드에는
        // @PreAuthorize("@projectAccess.isMember(#request.project_id())")가 붙어 있고, 그 표현식과
        // 본문 분기가 같은 project_members 테이블을 본다. 따라서 비멤버는 본문에 도달하기 전에
        // 메서드 보안에서 잘리고, 사용자가 실제로 받는 코드는 FORBIDDEN이다.
        //
        // 단위 테스트가 이를 못 잡은 이유는 standaloneSetup이 @PreAuthorize를 적용하지 않기 때문이다.
        // 본문 분기를 정리하거나 메서드 보안을 떼면 이 테스트가 실패하므로 그때 의도적으로 갱신한다.
        command(strangerToken, projectId, "남의 프로젝트에 보내는 명령")
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verify(fastApiAssistantClient, never()).command(any());
    }

    /** command로 confirm 응답을 받아 소유권이 실제 Redis에 기록되게 한다. 반환값은 발급된 thread_id. */
    private String issueConfirmThreadTo(String token, String threadId) throws Exception {
        Map<String, Object> card = Map.of(
            "step_id", STEP_ID,
            "tool", "set_due_date",
            "task_id", 1,
            "title", "API 구현",
            "summary", "마감을 내일로 변경",
            "args", Map.of("due_date", "2026-07-28")
        );
        when(fastApiAssistantClient.command(any(FastApiAssistantRequest.class)))
            .thenReturn(new AssistantResponse("confirm", "이 작업을 실행할까요?", List.of(), threadId, card));

        command(token, projectId, "API 구현 업무 마감을 내일로 바꿔줘")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.thread_id").value(threadId));
        return threadId;
    }

    private ResultActions command(String token, long targetProjectId, String question) throws Exception {
        return mockMvc.perform(post(COMMAND_PATH)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"project_id\":" + targetProjectId + ",\"question\":\"" + question + "\",\"history\":[]}"));
    }

    private ResultActions resume(String token, long targetProjectId, String threadId) throws Exception {
        return mockMvc.perform(post(RESUME_PATH)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"project_id\":" + targetProjectId + ",\"thread_id\":\"" + threadId
                + "\",\"step_id\":\"" + STEP_ID + "\",\"ok\":true}"));
    }

    private String issueToken(long userId) {
        return jwtService.issueAccessToken(userRepository.findById(userId).orElseThrow());
    }

    private long createUser(String email, String name) {
        return userRepository.save(new User(email, name, "local", email)).getId();
    }

    private long insertProject(String title) {
        Long id = jdbcTemplate.queryForObject(
            "INSERT INTO projects (title, type) VALUES (?, 'team') RETURNING id", Long.class, title
        );
        if (id == null) {
            throw new IllegalStateException("프로젝트 생성 실패: " + title);
        }
        return id;
    }

    private void addMember(long targetProjectId, long userId, String role) {
        jdbcTemplate.update(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)",
            targetProjectId, userId, role
        );
    }

    /** 컨테이너를 다른 테스트 클래스와 공유하므로 앞선 실행이 남긴 행을 먼저 지운다. */
    private void cleanUpPreviousRun() {
        jdbcTemplate.update(
            "DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE title LIKE 'assistant-thread-%')"
        );
        jdbcTemplate.update("DELETE FROM projects WHERE title LIKE 'assistant-thread-%'");
        jdbcTemplate.update("DELETE FROM users WHERE email LIKE 'assistant-%@workflow.test'");
    }
}
