package com.workflowai.notification;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findTop20ByUserIdOrderByCreatedAtDesc(Long userId);

    long countByUserIdAndReadFalse(Long userId);

    List<Notification> findByUserIdAndReadFalse(Long userId);

    /** id가 넘어와도 본인 소유가 아니면 걸러진다 — 다른 사람 알림을 id만 알고 읽음 처리할 수 없게 막는다. */
    List<Notification> findByIdInAndUserId(List<Long> ids, Long userId);

    /** 안 읽은 알림 중 보이는 개수(20건)를 넘는 과거 것은 새 알림이 쌓일 때마다 자동으로 정리한다. */
    @Modifying
    @Query(value = """
        DELETE FROM notifications
        WHERE user_id = :userId
          AND is_read = false
          AND id NOT IN (
            SELECT id FROM notifications
            WHERE user_id = :userId AND is_read = false
            ORDER BY created_at DESC, id DESC
            LIMIT 20
          )
        """, nativeQuery = true)
    void deleteExcessUnreadByUserId(@Param("userId") Long userId);

    /** 읽은 알림은 보관할 필요가 없으므로 읽음 처리되는 즉시 삭제한다. */
    void deleteByUserIdAndReadTrue(Long userId);
}
