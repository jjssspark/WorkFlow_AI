package com.workflowai.notification;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(NotificationController.class)
@AutoConfigureMockMvc(addFilters = false)
class NotificationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private NotificationRepository notificationRepository;

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
    void listsNotificationsForCurrentUser() throws Exception {
        authenticateAs(5L);
        Notification n = new Notification(5L, "TASK_ASSIGNED", "새 업무 배정", "'로그인 API' 업무가 배정되었습니다.", "task", 42L);
        when(notificationRepository.findTop50ByUserIdOrderByCreatedAtDesc(5L)).thenReturn(List.of(n));

        mockMvc.perform(get("/api/v1/notifications"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data[0].type").value("TASK_ASSIGNED"))
            .andExpect(jsonPath("$.data[0].title").value("새 업무 배정"));
    }

    @Test
    void returnsUnreadCount() throws Exception {
        authenticateAs(5L);
        when(notificationRepository.countByUserIdAndReadFalse(5L)).thenReturn(3L);

        mockMvc.perform(get("/api/v1/notifications/unread-count"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.count").value(3));
    }

    @Test
    void marksOnlyTheGivenIdsRead() throws Exception {
        authenticateAs(5L);
        Notification n1 = new Notification(5L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
        Notification n2 = new Notification(5L, "TASK_ASSIGNED", "제목2", "내용2", "task", 11L);
        when(notificationRepository.findByIdInAndUserId(eq(List.of(10L, 11L)), eq(5L)))
            .thenReturn(List.of(n1, n2));

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[10,11]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(notificationRepository).saveAll(List.of(n1, n2));
    }

    // 목록 조회 시점 이후에 새로 도착한 알림은 이 요청의 ids에 없으므로, 여기서 절대 읽음 처리되지 않는다
    // (예전 "전체 읽음 처리"가 갖고 있던 경쟁 조건을 이 방식으로 원천 차단한다).
    @Test
    void doesNotTouchNotificationsOutsideTheGivenIds() throws Exception {
        authenticateAs(5L);
        Notification n1 = new Notification(5L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
        when(notificationRepository.findByIdInAndUserId(eq(List.of(10L)), eq(5L))).thenReturn(List.of(n1));

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[10]}"))
            .andExpect(status().isOk());

        verify(notificationRepository).saveAll(List.of(n1));
        verify(notificationRepository, never()).findByUserIdAndReadFalse(eq(5L));
    }

    @Test
    void doesNothingWhenIdsIsEmpty() throws Exception {
        authenticateAs(5L);

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[]}"))
            .andExpect(status().isOk());

        verify(notificationRepository, never()).findByIdInAndUserId(eq(List.of()), eq(5L));
        verify(notificationRepository, never()).saveAll(List.of());
    }

    @Test
    void filtersOutNullAndNonPositiveIdsAndDedupesBeforeLookup() throws Exception {
        authenticateAs(5L);
        Notification n1 = new Notification(5L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
        when(notificationRepository.findByIdInAndUserId(eq(List.of(10L)), eq(5L))).thenReturn(List.of(n1));

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[10,10,null,-1,0]}"))
            .andExpect(status().isOk());

        verify(notificationRepository).findByIdInAndUserId(List.of(10L), 5L);
        verify(notificationRepository).saveAll(List.of(n1));
    }

    @Test
    void doesNothingWhenAllIdsAreInvalidAfterFiltering() throws Exception {
        authenticateAs(5L);

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[null,-1,0]}"))
            .andExpect(status().isOk());

        verify(notificationRepository, never()).findByIdInAndUserId(org.mockito.ArgumentMatchers.any(), eq(5L));
        verify(notificationRepository, never()).saveAll(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void capsIdsAtFifty() throws Exception {
        authenticateAs(5L);
        List<Long> tooMany = java.util.stream.LongStream.rangeClosed(1, 60).boxed().toList();
        List<Long> expectedCapped = tooMany.subList(0, 50);
        String idsJson = tooMany.toString();
        when(notificationRepository.findByIdInAndUserId(eq(expectedCapped), eq(5L))).thenReturn(List.of());

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":" + idsJson + "}"))
            .andExpect(status().isOk());

        verify(notificationRepository).findByIdInAndUserId(expectedCapped, 5L);
    }
}
