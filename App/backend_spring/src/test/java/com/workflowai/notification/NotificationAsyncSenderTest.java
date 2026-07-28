package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;

@ExtendWith(MockitoExtension.class)
class NotificationAsyncSenderTest {

    @Mock
    private NotificationRepository notificationRepository;
    @Mock
    private PlatformTransactionManager transactionManager;
    @Mock
    private NotificationBroadcaster broadcaster;
    @Mock
    private NotificationProjectResolver projectResolver;

    private NotificationAsyncSender newSender() {
        return new NotificationAsyncSender(notificationRepository, transactionManager, broadcaster, projectResolver);
    }

    @Test
    void sendSafelyBroadcastsTheSavedNotificationToTheOwningUser() {
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));
        // 클라이언트가 현재 보고 있는 프로젝트의 알림만 띄우려면 push payload에도 projectId가 있어야 한다.
        when(projectResolver.resolve(any(Notification.class))).thenReturn(7L);
        NotificationAsyncSender sender = newSender();

        sender.sendSafely(5L, "TASK_ASSIGNED", "새 업무 배정", "'로그인 API' 업무가 배정되었습니다.", "task", 42L);

        ArgumentCaptor<NotificationDto> captor = ArgumentCaptor.forClass(NotificationDto.class);
        verify(broadcaster).broadcast(eq(5L), captor.capture());
        NotificationDto dto = captor.getValue();
        assertThat(dto.type()).isEqualTo("TASK_ASSIGNED");
        assertThat(dto.title()).isEqualTo("새 업무 배정");
        assertThat(dto.targetType()).isEqualTo("task");
        assertThat(dto.targetId()).isEqualTo("42");
        assertThat(dto.projectId()).isEqualTo("7");
        verify(notificationRepository).deleteExcessByUserId(5L);
    }

    @Test
    void sendSafelyDoesNotBroadcastWhenSaveFails() {
        when(notificationRepository.save(any(Notification.class))).thenThrow(new RuntimeException("db down"));
        NotificationAsyncSender sender = newSender();

        sender.sendSafely(5L, "TASK_ASSIGNED", "제목", "내용", "task", 42L);

        verify(broadcaster, never()).broadcast(any(), any());
    }
}
