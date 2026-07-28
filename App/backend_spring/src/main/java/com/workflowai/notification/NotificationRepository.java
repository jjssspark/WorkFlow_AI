package com.workflowai.notification;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findTop20ByUserIdAndProjectIdOrderByCreatedAtDesc(Long userId, Long projectId);

    long countByUserIdAndProjectIdAndReadFalse(Long userId, Long projectId);

    List<Notification> findByUserIdAndReadFalse(Long userId);

    /** id가 넘어와도 본인 소유가 아니면 걸러진다 — 다른 사람 알림을 id만 알고 읽음 처리할 수 없게 막는다. */
    List<Notification> findByIdInAndUserId(List<Long> ids, Long userId);

    /** 프로젝트별 미읽음 뱃지용. project_id가 NULL인 과거 행은 집계에서 제외한다. */
    @Query("""
        SELECT n.projectId AS projectId, COUNT(n) AS unreadCount
          FROM Notification n
         WHERE n.userId = :userId AND n.read = false AND n.projectId IS NOT NULL
         GROUP BY n.projectId
        """)
    List<UnreadCountByProject> countUnreadGroupedByProject(@Param("userId") Long userId);

    interface UnreadCountByProject {
        Long getProjectId();
        long getUnreadCount();
    }

    /**
     * 보이는 개수(20건)를 넘는 과거 알림을 정리한다.
     *
     * 쿼터가 프로젝트별인 이유: 사용자 단위로 20건만 남기면, 알림이 활발한 프로젝트가 쿼터를
     * 독점해 다른 프로젝트의 안 읽은 알림이 사용자가 보기도 전에 삭제된다. 여러 프로젝트에
     * 참여하는 사용자에게는 이게 곧 알림 유실이다.
     */
    @Modifying
    @Query(value = """
        DELETE FROM notifications
        WHERE user_id = :userId
          AND project_id = :projectId
          AND id NOT IN (
            SELECT id FROM notifications
            WHERE user_id = :userId
              AND project_id = :projectId
            ORDER BY created_at DESC, id DESC
            LIMIT 20
          )
        """, nativeQuery = true)
    void deleteExcessByUserIdAndProjectId(@Param("userId") Long userId, @Param("projectId") Long projectId);
}
