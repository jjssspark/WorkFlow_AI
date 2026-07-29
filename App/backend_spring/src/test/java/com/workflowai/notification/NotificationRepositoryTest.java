package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
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

    private Notification save(Long userId, Long projectId, String title, LocalDateTime createdAt) {
        Notification notification = new Notification(userId, projectId, "TEST", title, "content", null, null);
        ReflectionTestUtils.setField(notification, "createdAt", createdAt);
        return notificationRepository.save(notification);
    }

    @Test
    void deleteExcessByUserIdKeepsOnlyTheMostRecentTwenty() {
        Long userId = 99L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(userId, 1L, "title" + i, base.plusSeconds(i));
        }

        notificationRepository.deleteExcessByUserIdAndProjectId(userId, 1L);

        List<Notification> remaining =
            notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(userId, 1L);
        assertThat(remaining).hasSize(20);
        // 가장 최근 25건 중 마지막 20건(title5~title24)만 남아야 한다.
        assertThat(remaining.get(0).getTitle()).isEqualTo("title24");
        assertThat(remaining.get(19).getTitle()).isEqualTo("title5");
    }

    @Test
    void deleteExcessByUserIdDoesNothingWhenAtOrBelowLimit() {
        Long userId = 100L;
        for (int i = 0; i < 10; i++) {
            save(userId, 1L, "title" + i, LocalDateTime.now().minusSeconds(i));
        }

        notificationRepository.deleteExcessByUserIdAndProjectId(userId, 1L);

        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(userId, 1L)).hasSize(10);
    }

    @Test
    void deleteExcessByUserIdDoesNotAffectOtherUsers() {
        Long targetUser = 101L;
        Long otherUser = 102L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            save(targetUser, 1L, "title" + i, base.plusSeconds(i));
        }
        save(otherUser, 1L, "other", LocalDateTime.now());

        notificationRepository.deleteExcessByUserIdAndProjectId(targetUser, 1L);

        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(otherUser, 1L))
            .hasSize(1);
    }

    @Test
    void deleteExcessByUserIdDeletesReadNotificationsTooWhenOverLimit() {
        Long userId = 103L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        for (int i = 0; i < 25; i++) {
            Notification notification = save(userId, 1L, "title" + i, base.plusSeconds(i));
            if (i < 5) {
                notification.markRead();
                notificationRepository.save(notification);
            }
        }

        notificationRepository.deleteExcessByUserIdAndProjectId(userId, 1L);

        // 읽음 여부와 무관하게 최신 20건만 남고, 오래된 5건(읽은 것 포함)은 삭제된다.
        assertThat(notificationRepository.count()).isEqualTo(20);
    }

    @Test
    @DisplayName("한 프로젝트의 알림이 넘쳐도 다른 프로젝트의 알림은 삭제되지 않는다")
    void deleteExcessDoesNotEvictOtherProjectsNotifications() {
        Long userId = 200L;
        Long projectA = 1L;
        Long projectB = 2L;
        LocalDateTime base = LocalDateTime.now().minusDays(1);

        // 프로젝트 B에 오래된 알림 3건 — 사용자 단위 쿼터였다면 A의 30건에 밀려 전부 사라진다.
        for (int i = 0; i < 3; i++) {
            save(userId, projectB, "b" + i, base.plusSeconds(i));
        }
        for (int i = 0; i < 30; i++) {
            save(userId, projectA, "a" + i, base.plusSeconds(100 + i));
        }

        notificationRepository.deleteExcessByUserIdAndProjectId(userId, projectA);

        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(userId, projectA))
            .hasSize(20);
        assertThat(notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(userId, projectB))
            .hasSize(3);
    }

    @Test
    @DisplayName("프로젝트별 조회는 다른 프로젝트의 알림을 반환하지 않는다")
    void findTop20ScopesByProject() {
        Long userId = 201L;
        save(userId, 1L, "a", LocalDateTime.now().minusSeconds(2));
        save(userId, 2L, "b", LocalDateTime.now().minusSeconds(1));

        List<Notification> projectOne =
            notificationRepository.findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(userId, 1L);

        assertThat(projectOne).hasSize(1);
        assertThat(projectOne.get(0).getTitle()).isEqualTo("a");
    }

    /**
     * UT-135. 미읽음 뱃지 숫자를 만드는 쿼리다. NotificationControllerTest는 이 메서드를 목으로 두고
     * 반환값을 그대로 응답에 싣는지만 보므로, 조건 세 개(본인·해당 프로젝트·안 읽음) 중 어느 하나가
     * 빠져도 거기서는 드러나지 않는다. 그래서 세 조건 각각에 대해 걸러져야 할 행을 함께 넣는다.
     */
    @Test
    @DisplayName("미읽음 개수는 본인·해당 프로젝트·안 읽은 알림만 센다")
    void countUnreadScopesByUserProjectAndReadFlag() {
        Long userId = 203L;
        Long otherUserId = 204L;
        save(userId, 1L, "미읽음1", LocalDateTime.now());
        save(userId, 1L, "미읽음2", LocalDateTime.now());

        Notification alreadyRead = save(userId, 1L, "읽음", LocalDateTime.now());
        alreadyRead.markRead();
        notificationRepository.save(alreadyRead);

        save(userId, 2L, "다른 프로젝트", LocalDateTime.now());
        save(otherUserId, 1L, "다른 사람", LocalDateTime.now());

        assertThat(notificationRepository.countByUserIdAndProjectIdAndReadFalse(userId, 1L)).isEqualTo(2);
    }

    /**
     * UT-136. 읽음 처리는 id 목록만 받는다. 남의 알림 id를 끼워 넣어도 이 쿼리에서 걸러지지 않으면
     * 그 알림이 그대로 읽음 처리되어 상대의 뱃지가 임의로 꺼진다. 컨트롤러에는 이 외에 소유자 검사가
     * 없으므로, 여기가 유일한 방어선이다.
     */
    @Test
    @DisplayName("id로 조회해도 본인 소유가 아닌 알림은 반환되지 않는다")
    void findByIdInAndUserIdExcludesOtherUsersNotifications() {
        Long userId = 205L;
        Long otherUserId = 206L;
        Notification mine = save(userId, 1L, "내 알림", LocalDateTime.now());
        Notification theirs = save(otherUserId, 1L, "남의 알림", LocalDateTime.now());

        List<Notification> found =
            notificationRepository.findByIdInAndUserId(List.of(mine.getId(), theirs.getId()), userId);

        assertThat(found).extracting(Notification::getId).containsExactly(mine.getId());
    }

    @Test
    @DisplayName("미읽음 개수를 프로젝트별로 집계한다")
    void countUnreadGroupedByProject() {
        Long userId = 202L;
        save(userId, 1L, "a1", LocalDateTime.now());
        save(userId, 1L, "a2", LocalDateTime.now());
        save(userId, 2L, "b1", LocalDateTime.now());

        Map<Long, Long> counts = notificationRepository.countUnreadGroupedByProject(userId).stream()
            .collect(Collectors.toMap(
                NotificationRepository.UnreadCountByProject::getProjectId,
                NotificationRepository.UnreadCountByProject::getUnreadCount));

        assertThat(counts).containsExactlyInAnyOrderEntriesOf(Map.of(1L, 2L, 2L, 1L));
    }
}
