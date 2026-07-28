package com.workflowai.reviewer;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewerActivityRepository extends JpaRepository<ReviewerActivity, Long> {
    /**
     * 특정 심사자의 최근 활동. 카드에 보여줄 만큼만 필요하므로 Pageable로 건수를 제한한다.
     * createdAt이 같은 초에 여러 건 쌓일 수 있어(예: 점수 저장 직후 확정) id로 2차 정렬해
     * 순서가 요청마다 흔들리지 않게 한다.
     */
    List<ReviewerActivity> findAllByUserIdOrderByCreatedAtDescIdDesc(Long userId, Pageable pageable);

    /**
     * 배정 프로젝트 목록을 최근 접속순으로 정렬하기 위한 조회. 프로젝트별 마지막 접속 시각만
     * 있으면 되므로 PROJECT_ACCESS만 골라 집계한다 — 최근 활동 목록은 건수 제한이 있어
     * 오래전에 접속한 프로젝트가 빠질 수 있으므로 정렬에는 쓸 수 없다.
     */
    @Query("""
        select ra.projectId as projectId, max(ra.createdAt) as lastAccessedAt
        from ReviewerActivity ra
        where ra.userId = :userId
          and ra.activityType = com.workflowai.reviewer.ReviewerActivityType.PROJECT_ACCESS
        group by ra.projectId
        """)
    List<ProjectLastAccessView> findLastAccessByUserId(@Param("userId") Long userId);

    interface ProjectLastAccessView {
        Long getProjectId();

        LocalDateTime getLastAccessedAt();
    }
}
