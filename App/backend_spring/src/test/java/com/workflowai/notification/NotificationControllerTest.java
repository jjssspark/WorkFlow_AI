package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import testsupport.AccessDeniedEnvelopeAdvice;

// MethodSecurityTestConfig가 필요한 이유: NotificationController의 getNotifications/getUnreadCount/
// notifyProgressReportReady가 @PreAuthorize("@projectAccess.isMember(...)")로 프로젝트 멤버십을
// 검사하는데, 순수 @WebMvcTest는 메서드 보안을 로드하지 않는다. 다른 컨트롤러들(RagControllerSecurityTest,
// TaskControllerSecurityTest 등)과 동일한 패턴으로 @EnableMethodSecurity + 실제 ProjectAccess 빈을
// 구성하고, 그 아래의 ProjectMemberRepository만 목으로 대체해 멤버십 여부를 직접 제어한다.
@WebMvcTest(NotificationController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = NotificationControllerTest.MethodSecurityTestConfig.class)
class NotificationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private NotificationRepository notificationRepository;

    @MockitoBean
    private NotificationBroadcaster notificationBroadcaster;

    @MockitoBean
    private NotificationService notificationService;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private DemoDataService demoDataService;

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

    private void stubMember(long projectId, long userId, boolean isMember) {
        when(projectMemberRepository.existsByProjectIdAndUserId(projectId, userId)).thenReturn(isMember);
    }

    @Test
    void listsNotificationsForCurrentUser() throws Exception {
        authenticateAs(5L);
        stubMember(1L, 5L, true);
        Notification n = new Notification(5L, 1L, "TASK_ASSIGNED", "새 업무 배정", "'로그인 API' 업무가 배정되었습니다.", "task", 42L);
        when(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(5L, 1L)).thenReturn(List.of(n));

        mockMvc.perform(get("/api/v1/notifications").param("projectId", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data[0].type").value("TASK_ASSIGNED"))
            .andExpect(jsonPath("$.data[0].title").value("새 업무 배정"));
    }

    @Test
    @DisplayName("멤버가 아닌 프로젝트의 알림을 조회하면 403")
    void getNotificationsRejectsNonMemberProject() throws Exception {
        authenticateAs(5L);
        stubMember(999L, 5L, false);

        mockMvc.perform(get("/api/v1/notifications").param("projectId", "999"))
            .andExpect(status().isForbidden());
    }

    @Test
    void returnsUnreadCount() throws Exception {
        authenticateAs(5L);
        stubMember(1L, 5L, true);
        when(notificationRepository.countByUserIdAndProjectIdAndReadFalse(5L, 1L)).thenReturn(3L);

        mockMvc.perform(get("/api/v1/notifications/unread-count").param("projectId", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.count").value(3));
    }

    @Test
    @DisplayName("프로젝트별 미읽음 개수를 맵으로 반환한다")
    void unreadCountsReturnsPerProjectMap() throws Exception {
        authenticateAs(5L);
        NotificationRepository.UnreadCountByProject row = new NotificationRepository.UnreadCountByProject() {
            @Override
            public Long getProjectId() {
                return 12L;
            }

            @Override
            public long getUnreadCount() {
                return 3L;
            }
        };
        when(notificationRepository.countUnreadGroupedByProject(5L)).thenReturn(List.of(row));

        mockMvc.perform(get("/api/v1/notifications/unread-counts"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.counts.12").value(3));
    }

    @Test
    void marksOnlyTheGivenIdsRead() throws Exception {
        authenticateAs(5L);
        Notification n1 = new Notification(5L, 1L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
        Notification n2 = new Notification(5L, 1L, "TASK_ASSIGNED", "제목2", "내용2", "task", 11L);
        when(notificationRepository.findByIdInAndUserId(eq(List.of(10L, 11L)), eq(5L)))
            .thenReturn(List.of(n1, n2));

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[10,11]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(notificationRepository).saveAll(List.of(n1, n2));
        assertThat(n1.isRead()).isTrue();
        assertThat(n2.isRead()).isTrue();
    }

    // 목록 조회 시점 이후에 새로 도착한 알림은 이 요청의 ids에 없으므로, 여기서 절대 읽음 처리되지 않는다
    // (예전 "전체 읽음 처리"가 갖고 있던 경쟁 조건을 이 방식으로 원천 차단한다).
    @Test
    void doesNotTouchNotificationsOutsideTheGivenIds() throws Exception {
        authenticateAs(5L);
        Notification n1 = new Notification(5L, 1L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
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
        Notification n1 = new Notification(5L, 1L, "TASK_ASSIGNED", "제목1", "내용1", "task", 10L);
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
    void capsIdsAtTwenty() throws Exception {
        authenticateAs(5L);
        List<Long> tooMany = java.util.stream.LongStream.rangeClosed(1, 60).boxed().toList();
        List<Long> expectedCapped = tooMany.subList(0, 20);
        String idsJson = tooMany.toString();
        when(notificationRepository.findByIdInAndUserId(eq(expectedCapped), eq(5L))).thenReturn(List.of());

        mockMvc.perform(patch("/api/v1/notifications/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":" + idsJson + "}"))
            .andExpect(status().isOk());

        verify(notificationRepository).findByIdInAndUserId(expectedCapped, 5L);
    }

    @Test
    void streamStartsAnAsyncSseSubscriptionForCurrentUser() throws Exception {
        authenticateAs(5L);
        when(notificationBroadcaster.subscribe(5L)).thenReturn(new SseEmitter());

        mockMvc.perform(get("/api/v1/notifications/stream"))
            .andExpect(request().asyncStarted());

        verify(notificationBroadcaster).subscribe(5L);
    }

    @Test
    void createsProgressReportReadyNotificationForCurrentUser() throws Exception {
        authenticateAs(5L);
        stubMember(1L, 5L, true);

        mockMvc.perform(post("/api/v1/notifications/progress-report")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"projectId\":1,\"content\":\"보고서 생성 완료\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(notificationService).notifyAfterCommit(
            5L,
            1L,
            "PROGRESS_REPORT",
            "진행률 보고서가 생성되었습니다.",
            "보고서 생성 완료",
            "project",
            null
        );
    }

    @Configuration
    @EnableMethodSecurity
    @Import(NotificationController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedResponseAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }

        @Bean("projectAccess")
        ProjectAccess projectAccess(ProjectMemberRepository projectMemberRepository, DemoDataService demoDataService) {
            return new ProjectAccess(projectMemberRepository, demoDataService);
        }
    }
}
