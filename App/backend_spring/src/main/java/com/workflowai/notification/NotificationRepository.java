package com.workflowai.notification;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findTop20ByUserIdOrderByCreatedAtDesc(Long userId);

    List<Notification> findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(Long userId, Long projectId);

    long countByUserIdAndReadFalse(Long userId);

    long countByUserIdAndProjectIdAndReadFalse(Long userId, Long projectId);

    List<Notification> findByUserIdAndReadFalse(Long userId);

    /** id가 넘어와도 본인 소유가 아니면 걸러진다 — 다른 사람 알림을 id만 알고 읽음 처리할 수 없게 막는다. */
    List<Notification> findByIdInAndUserId(List<Long> ids, Long userId);

    /** 보이는 개수(20건)를 넘는 과거 알림은 읽음 여부와 무관하게 새 알림이 쌓일 때마다 자동으로 정리한다. */
    @Modifying
    @Query(value = """
        DELETE FROM notifications
        WHERE user_id = :userId
          AND id NOT IN (
            SELECT id FROM notifications
            WHERE user_id = :userId
            ORDER BY created_at DESC, id DESC
            LIMIT 20
          )
        """, nativeQuery = true)
    void deleteExcessByUserId(@Param("userId") Long userId);
}
