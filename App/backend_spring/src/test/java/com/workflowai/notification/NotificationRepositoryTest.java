package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

@DataJpaTest
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class NotificationRepositoryTest {

    @Autowired
    private NotificationRepository notificationRepository;

    private Notification save(Long userId, String title, LocalDateTime createdAt, boolean read) {
        Notification notification = new Notification(userId, "TEST", title, "content", null, null);
        ReflectionTestUtils.setField(notification, "createdAt", createdAt);
        if (read) {
            notification.markRead();
        }
        return notificationRepository.save(notification);
    }

    @Test
    void deleteExcessUnreadByUserIdKeepsOnlyTheMostRecentTwentyUnread() {
        Long userId = 99L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(userId, "title" + i, base.plusSeconds(i), false);
        }

        notificationRepository.deleteExcessUnreadByUserId(userId);

        List<Notification> remaining = notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId);
        assertThat(remaining).hasSize(20);
        // 가장 최근 25건 중 마지막 20건(title5~title24)만 남아야 한다.
        assertThat(remaining.get(0).getTitle()).isEqualTo("title24");
        assertThat(remaining.get(19).getTitle()).isEqualTo("title5");
    }

    @Test
    void deleteExcessUnreadByUserIdDoesNothingWhenAtOrBelowLimit() {
        Long userId = 100L;
        for (int i = 0; i < 10; i++) {
            save(userId, "title" + i, LocalDateTime.now().minusSeconds(i), false);
        }

        notificationRepository.deleteExcessUnreadByUserId(userId);

        assertThat(notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId)).hasSize(10);
    }

    @Test
    void deleteExcessUnreadByUserIdDoesNotAffectOtherUsers() {
        Long targetUser = 101L;
        Long otherUser = 102L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(targetUser, "title" + i, base.plusSeconds(i), false);
        }
        save(otherUser, "other", LocalDateTime.now(), false);

        notificationRepository.deleteExcessUnreadByUserId(targetUser);

        assertThat(notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(otherUser)).hasSize(1);
    }

    @Test
    void deleteExcessUnreadByUserIdNeverDeletesReadNotificationsRegardlessOfAge() {
        Long userId = 103L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        // 아주 오래된 읽은 알림 5건 + 안 읽은 알림 25건
        for (int i = 0; i < 5; i++) {
            save(userId, "read" + i, base.minusDays(10).plusSeconds(i), true);
        }
        for (int i = 0; i < 25; i++) {
            save(userId, "unread" + i, base.plusSeconds(i), false);
        }

        notificationRepository.deleteExcessUnreadByUserId(userId);

        long readCount = notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId).stream()
            .filter(Notification::isRead)
            .count();
        assertThat(readCount).isZero(); // 읽은 알림 5건은 findTop20 안에 안 잡힐 만큼 안읽은 알림이 많으므로 별도 확인
        assertThat(notificationRepository.count()).isEqualTo(5 + 20); // 읽은 5건은 그대로, 안읽은 건 20건만 남음
    }

    @Test
    void deleteByUserIdAndReadTrueRemovesOnlyReadNotifications() {
        Long userId = 104L;
        save(userId, "read1", LocalDateTime.now(), true);
        save(userId, "read2", LocalDateTime.now(), true);
        save(userId, "unread1", LocalDateTime.now(), false);

        notificationRepository.deleteByUserIdAndReadTrue(userId);

        List<Notification> remaining = notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId);
        assertThat(remaining).hasSize(1);
        assertThat(remaining.get(0).getTitle()).isEqualTo("unread1");
    }
}
