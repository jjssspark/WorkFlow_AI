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

    private Notification save(Long userId, String title, LocalDateTime createdAt) {
        Notification notification = new Notification(userId, "TEST", title, "content", null, null);
        ReflectionTestUtils.setField(notification, "createdAt", createdAt);
        return notificationRepository.save(notification);
    }

    @Test
    void deleteExcessByUserIdKeepsOnlyTheMostRecentTwenty() {
        Long userId = 99L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(userId, "title" + i, base.plusSeconds(i));
        }

        notificationRepository.deleteExcessByUserId(userId);

        List<Notification> remaining = notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId);
        assertThat(remaining).hasSize(20);
        // 가장 최근 25건 중 마지막 20건(title5~title24)만 남아야 한다.
        assertThat(remaining.get(0).getTitle()).isEqualTo("title24");
        assertThat(remaining.get(19).getTitle()).isEqualTo("title5");
    }

    @Test
    void deleteExcessByUserIdDoesNothingWhenAtOrBelowLimit() {
        Long userId = 100L;
        for (int i = 0; i < 10; i++) {
            save(userId, "title" + i, LocalDateTime.now().minusSeconds(i));
        }

        notificationRepository.deleteExcessByUserId(userId);

        assertThat(notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(userId)).hasSize(10);
    }

    @Test
    void deleteExcessByUserIdDoesNotAffectOtherUsers() {
        Long targetUser = 101L;
        Long otherUser = 102L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(targetUser, "title" + i, base.plusSeconds(i));
        }
        save(otherUser, "other", LocalDateTime.now());

        notificationRepository.deleteExcessByUserId(targetUser);

        assertThat(notificationRepository.findTop20ByUserIdOrderByCreatedAtDesc(otherUser)).hasSize(1);
    }

    @Test
    void deleteExcessByUserIdDeletesReadNotificationsTooWhenOverLimit() {
        Long userId = 103L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            Notification notification = save(userId, "title" + i, base.plusSeconds(i));
            if (i < 5) {
                notification.markRead();
                notificationRepository.save(notification);
            }
        }

        notificationRepository.deleteExcessByUserId(userId);

        // 읽음 여부와 무관하게 최신 20건만 남고, 오래된 5건(읽은 것 포함)은 삭제된다.
        assertThat(notificationRepository.count()).isEqualTo(20);
    }

    @Test
    void projectScopedQueryDoesNotMixNotificationsFromOtherProjects() {
        Notification projectOne = new Notification(
            200L, "TASK_ASSIGNED", "프로젝트 1", "content", "task", 1L, 1L
        );
        Notification projectTwo = new Notification(
            200L, "TASK_ASSIGNED", "프로젝트 2", "content", "task", 2L, 2L
        );
        notificationRepository.saveAll(List.of(projectOne, projectTwo));

        List<Notification> result =
            notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(200L, 1L);

        assertThat(result).extracting(Notification::getProjectId).containsExactly(1L);
        assertThat(result).extracting(Notification::getTitle).containsExactly("프로젝트 1");
    }
}
