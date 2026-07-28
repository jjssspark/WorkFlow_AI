package com.workflowai.task;

import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, Long> {
    /**
     * 상태 이동은 알림 생성 여부까지 현재 상태에 의존하므로 같은 업무의 동시 요청을 직렬화한다.
     * 두 번째 요청은 첫 번째 커밋 이후 상태를 읽어 동일 상태 이동 알림을 다시 만들지 않는다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Task t where t.id = :taskId")
    Optional<Task> findByIdForUpdate(@Param("taskId") Long taskId);

    List<Task> findByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Task> findByProjectIdOrderByStatusAscPositionAsc(Long projectId);

    Optional<Task> findFirstBySourceMeetingIdAndTitleAndAssigneeIdAndDueDate(
        Long sourceMeetingId,
        String title,
        Long assigneeId,
        LocalDate dueDate
    );

    List<Task> findBySourceMeetingId(Long sourceMeetingId);

    /** 새 업무를 컬럼 맨 끝에 추가할 때 쓸 기준값(해당 프로젝트+상태에서 가장 큰 position). */
    Optional<Task> findTopByProjectIdAndStatusOrderByPositionDesc(Long projectId, String status);

    Optional<Task> findTopByProjectIdAndStatusOrderByPositionAsc(Long projectId, String status);

    /** 완료 승인 대기 목록 화면용 — 팀원이 완료를 요청했고 아직 팀장이 승인/반려하지 않은 업무. */
    List<Task> findByProjectIdAndPendingApprovalTrueOrderByUpdatedAtAsc(Long projectId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Task t set t.sourceMeetingId = null where t.sourceMeetingId = :meetingId")
    int clearSourceMeetingId(@Param("meetingId") Long meetingId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from Task t where t.sourceMeetingId = :meetingId")
    int deleteBySourceMeetingId(@Param("meetingId") Long meetingId);

    /** 마일스톤 삭제 전에 연결 업무를 일정 미정 상태로 명시적으로 옮긴다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Task t set t.milestoneId = null where t.projectId = :projectId and t.milestoneId = :milestoneId")
    int clearMilestoneId(
        @Param("projectId") Long projectId,
        @Param("milestoneId") Long milestoneId
    );

    @Query("""
        select t.projectId as projectId,
               count(t.id) as totalCount,
               sum(case when t.status = :doneStatus then 1 else 0 end) as doneCount
        from Task t
        where t.projectId in :projectIds
        group by t.projectId
        """)
    List<TaskProgressView> summarizeProgressByProjectIds(
        @Param("projectIds") List<Long> projectIds,
        @Param("doneStatus") String doneStatus
    );

    interface TaskProgressView {
        Long getProjectId();

        Long getTotalCount();

        Long getDoneCount();
    }
}
