package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock
    private NotificationRepository notificationRepository;
    @Mock
    private PlatformTransactionManager transactionManager;

    private NotificationService newService() {
        NotificationAsyncSender asyncSender = new NotificationAsyncSender(notificationRepository, transactionManager);
        return new NotificationService(notificationRepository, asyncSender);
    }

    @Test
    void notifySavesNotificationWithGivenFields() {
        NotificationService service = newService();
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));

        service.notify(5L, "TASK_ASSIGNED", "새 업무 배정", "'로그인 API' 업무가 배정되었습니다.", "task", 42L);

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository).save(captor.capture());
        Notification saved = captor.getValue();
        assertThat(saved.getUserId()).isEqualTo(5L);
        assertThat(saved.getType()).isEqualTo("TASK_ASSIGNED");
        assertThat(saved.getTitle()).isEqualTo("새 업무 배정");
        assertThat(saved.getContent()).isEqualTo("'로그인 API' 업무가 배정되었습니다.");
        assertThat(saved.getTargetType()).isEqualTo("task");
        assertThat(saved.getTargetId()).isEqualTo(42L);
        assertThat(saved.isRead()).isFalse();
    }

    @Test
    void notifyAfterCommitSendsImmediatelyWhenNoActiveTransactionSynchronization() {
        NotificationService service = newService();
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));

        service.notifyAfterCommit(5L, "MEETING_SAVED", "저장 완료", "내용", "meeting", 1L);

        verify(notificationRepository, times(1)).save(any(Notification.class));
    }

    @Test
    void notifyActorAndCounterpartSendsOnlyOnceWhenActorEqualsCounterpart() {
        NotificationService service = newService();
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));

        service.notifyActorAndCounterpart(
            10L, "MEETING_SAVED", "저장 완료", "회의록이 저장되었습니다.",
            10L, "MEETING_SAVED_NOTIFY_LEADER", "저장 완료(팀장)", "역할분배를 진행해주세요.",
            "meeting", 1L
        );

        verify(notificationRepository, times(1)).save(any(Notification.class));
    }

    @Test
    void notifyActorAndCounterpartSendsBothWhenDifferentUsers() {
        NotificationService service = newService();
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));

        service.notifyActorAndCounterpart(
            10L, "MEETING_SAVED", "저장 완료", "회의록이 저장되었습니다.",
            20L, "MEETING_SAVED_NOTIFY_LEADER", "저장 완료(팀장)", "역할분배를 진행해주세요.",
            "meeting", 1L
        );

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository, times(2)).save(captor.capture());
        List<Notification> saved = captor.getAllValues();
        assertThat(saved).extracting(Notification::getUserId).containsExactlyInAnyOrder(10L, 20L);
        assertThat(saved).extracting(Notification::getType)
            .containsExactlyInAnyOrder("MEETING_SAVED", "MEETING_SAVED_NOTIFY_LEADER");
    }
}
