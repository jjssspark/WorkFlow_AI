package com.workflowai.activity;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ActivityRepository extends JpaRepository<Activity, Long> {
    List<Activity> findTop10ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findTop50ByProjectIdOrderByCreatedAtDesc(Long projectId);

    /**
     * 업무 활동 로그 조회. target_id는 판별 컬럼 없는 폴리모픽이라({@link ActivityTypes} 참조)
     * target_id만으로 찾으면 같은 숫자를 user id로 쓰는 평가 활동이 섞인다 — 제외 타입과
     * project_id를 함께 걸어 업무 이력만 남긴다.
     */
    List<Activity> findByProjectIdAndTargetIdAndTypeNotInOrderByCreatedAtDesc(
        Long projectId, Long targetId, List<String> excludedTypes
    );

    /**
     * 심사자 홈 "최근 심사 활동". createdAt이 같은 초에 여러 건 쌓일 수 있어(점수 저장 직후 확정 등)
     * id로 2차 정렬해 순서가 요청마다 흔들리지 않게 한다.
     */
    List<Activity> findTop10ByActorIdAndTypeInOrderByCreatedAtDescIdDesc(Long actorId, List<String> types);

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
