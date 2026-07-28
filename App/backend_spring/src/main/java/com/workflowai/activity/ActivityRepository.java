package com.workflowai.activity;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ActivityRepository extends JpaRepository<Activity, Long> {
    List<Activity> findTop10ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findTop50ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findByTargetIdOrderByCreatedAtDesc(Long targetId);

    List<Activity> findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types);

    /**
     * 배정 프로젝트 목록을 최근 접속순으로 정렬하기 위한 조회. 프로젝트별 마지막 접속 시각만
     * 있으면 되므로 PROJECT_ACCESS만 골라 집계한다 — "최근 심사 활동" 카드는 건수 제한이 있어
     * 오래전에 접속한 프로젝트가 빠질 수 있으므로 정렬에는 쓸 수 없다.
     */
    @Query("""
        select a.projectId as projectId, max(a.createdAt) as lastAccessedAt
        from Activity a
        where a.actorId = :actorId and a.type = 'PROJECT_ACCESS'
        group by a.projectId
        """)
    List<ProjectLastAccessView> findLastProjectAccessByActorId(@Param("actorId") Long actorId);

    interface ProjectLastAccessView {
        Long getProjectId();

        LocalDateTime getLastAccessedAt();
    }
}
