package com.workflowai.project;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.UserPrincipal;
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
    void acceptSucceedsAndReturnsOk() throws Exception {
        authenticateAs(1L);
        doNothing().when(invitationService).accept(eq("VALIDTOKEN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/VALIDTOKEN/accept"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void acceptReturnsNotFoundWithInviteNotFoundCodeWhenTokenUnknown() throws Exception {
        authenticateAs(1L);
        doThrow(new IllegalArgumentException("초대를 찾을 수 없습니다."))
            .when(invitationService).accept(eq("UNKNOWN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/UNKNOWN/accept"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("INVITE_NOT_FOUND"));
    }

    @Test
    void acceptReturnsConflictWithAlreadyProcessedCodeWhenInvitationNotPending() throws Exception {
        authenticateAs(1L);
        doThrow(new IllegalStateException("이미 처리된 초대입니다."))
            .when(invitationService).accept(eq("USEDTOKEN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/USEDTOKEN/accept"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("INVITE_ALREADY_PROCESSED"));
    }

    @Test
    void acceptReturnsConflictWithAlreadyProcessedCodeWhenInvitationExpired() throws Exception {
        authenticateAs(1L);
        doThrow(new IllegalStateException("만료된 초대입니다."))
            .when(invitationService).accept(eq("EXPIREDTOKEN"), anyLong());

        mockMvc.perform(post("/api/v1/invitations/EXPIREDTOKEN/accept"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.error.code").value("INVITE_ALREADY_PROCESSED"));
    }
}
