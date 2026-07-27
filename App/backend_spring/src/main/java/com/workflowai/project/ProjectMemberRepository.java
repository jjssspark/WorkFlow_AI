package com.workflowai.project;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {
    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    List<ProjectMember> findAllByProjectId(Long projectId);

    List<ProjectMember> findAllByUserId(Long userId);

    long countByProjectId(Long projectId);

    /** 팀 규모(예상 인원 대비 현재 인원 등) 표시용 인원 수 — 심사자는 팀원이 아니므로 제외한다. */
    long countByProjectIdAndRoleNot(Long projectId, ProjectRole role);

    /** 프로젝트당 팀장은 정확히 1명이라는 전제 하에 팀장을 조회한다(회의록 알림 수신자 결정용). */
    Optional<ProjectMember> findByProjectIdAndRole(Long projectId, ProjectRole role);

    List<ProjectMember> findAllByProjectIdInAndRole(List<Long> projectIds, ProjectRole role);

    /** 팀 규모 표시용 인원 수 — 심사자는 팀원이 아니므로 제외한다(ReviewerService의 memberCount에도 재사용됨). */
    @Query("""
        select pm.projectId as projectId, count(pm.id) as memberCount
        from ProjectMember pm
        where pm.projectId in :projectIds and pm.role <> com.workflowai.project.ProjectRole.REVIEWER
        group by pm.projectId
        """)
    List<ProjectMemberCountView> countMembersByProjectIds(@Param("projectIds") List<Long> projectIds);

    interface ProjectMemberCountView {
        Long getProjectId();

        Long getMemberCount();
    }
}
