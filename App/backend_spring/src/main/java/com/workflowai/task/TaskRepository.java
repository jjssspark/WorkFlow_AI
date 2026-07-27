package com.workflowai.task;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, Long> {
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

    /** 완료 승인 대기 목록 화면용 — 팀원이 완료를 요청했고 아직 팀장이 승인/반려하지 않은 업무. */
    List<Task> findByProjectIdAndPendingApprovalTrueOrderByUpdatedAtAsc(Long projectId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Task t set t.sourceMeetingId = null where t.sourceMeetingId = :meetingId")
    int clearSourceMeetingId(@Param("meetingId") Long meetingId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from Task t where t.sourceMeetingId = :meetingId")
    int deleteBySourceMeetingId(@Param("meetingId") Long meetingId);

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
