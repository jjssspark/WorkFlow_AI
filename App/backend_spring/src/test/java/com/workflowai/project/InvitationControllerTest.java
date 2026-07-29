package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.UserPrincipal;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 초대 수락(accept)이 실패 사유별로 구분되는 HTTP 상태/에러 코드를 반환하는지 검증한다.
 * 프론트엔드(InviteAcceptScreen)는 이 코드로 "초대 코드로 폴백해도 되는 경우"와
 * "그대로 실패를 보여줘야 하는 경우"를 구분하므로, 코드가 바뀌면 프론트 폴백 로직도 함께 깨진다.
 */
@WebMvcTest(InvitationController.class)
@AutoConfigureMockMvc(addFilters = false)
class InvitationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InvitationService invitationService;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    @Test
    void acceptSucceedsAndReturnsJoinedProjectId() throws Exception {
        authenticateAs(1L);
        // 프론트엔드는 이 id로 방금 참여한 프로젝트를 선택한다. 없으면 목록을 비교해 추측해야 하고,
        // 이미 멤버였던 사람은 새 항목이 없어 아무것도 선택하지 못한 채 대시보드로 간다.
        when(invitationService.accept(eq("VALIDTOKEN"), anyLong())).thenReturn(26L);

        mockMvc.perform(post("/api/v1/invitations/VALIDTOKEN/accept"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.projectId").value(26));
    }

    @Test
    void acceptReturnsNotFoundWithInviteNotFoundCodeWhenTokenUnknown() throws Exception {
        authenticateAs(1L);
        doThrow(InvitationException.notFound())
            .when(invitationService).accept(eq("UNKNOWN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/UNKNOWN/accept"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("INVITE_NOT_FOUND"));
    }

    @Test
    void acceptReturnsConflictWithAlreadyProcessedCodeWhenInvitationNotPending() throws Exception {
        authenticateAs(1L);
        doThrow(InvitationException.alreadyProcessed())
            .when(invitationService).accept(eq("USEDTOKEN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/USEDTOKEN/accept"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("INVITE_ALREADY_PROCESSED"));
    }

    @Test
    void acceptReturnsConflictWithExpiredCodeWhenInvitationExpired() throws Exception {
        authenticateAs(1L);
        doThrow(InvitationException.expired())
            .when(invitationService).accept(eq("EXPIREDTOKEN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/EXPIREDTOKEN/accept"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.success").value(false))
            // 재사용과 만료는 사용자에게 할 말이 다르다("이미 참여함" vs "새 링크를 받으세요").
            .andExpect(jsonPath("$.error.code").value("INVITE_EXPIRED"));
    }

    /**
     * 이 테스트가 이 파일에서 가장 중요하다. 예전 컨트롤러는 {@code IllegalArgumentException}을
     * 전부 404/INVITE_NOT_FOUND로 바꿨는데, 프론트엔드는 그 코드를 "이건 초대 토큰이 아니라 참여
     * 코드였다"는 신호로 읽고 폴백한다. 즉 초대 흐름 어디서든 터진 결함이 "유효하지 않은 초대
     * 코드"로 위장돼 사용자에게도, 로그에도 진짜 원인이 남지 않았다.
     */
    @Test
    void acceptDoesNotDisguiseUnexpectedFailuresAsInviteNotFound() {
        authenticateAs(1L);
        doThrow(new IllegalArgumentException("서비스 내부 검증 실패"))
            .when(invitationService).accept(eq("BOOMTOKEN"), anyLong());

        // envelope으로 바뀌지 않고 그대로 터져 나온다 = 500으로 나간다는 뜻이다.
        assertThatThrownBy(() -> mockMvc.perform(post("/api/v1/invitations/BOOMTOKEN/accept")))
            .hasRootCauseInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void createLinkReturnsIssuedTokenWithMemberRole() throws Exception {
        authenticateAs(1L);
        InvitationResponse response = new InvitationResponse(
            10L, null, "팀원", "LINK-TOKEN", "pending", LocalDateTime.now().plusDays(7)
        );
        when(invitationService.createLinkInvitation(10L)).thenReturn(response);

        mockMvc.perform(post("/api/v1/projects/10/invitations/link"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.token").value("LINK-TOKEN"))
            .andExpect(jsonPath("$.data.role").value("팀원"))
            .andExpect(jsonPath("$.data.email").value(nullValue()));
    }
}
