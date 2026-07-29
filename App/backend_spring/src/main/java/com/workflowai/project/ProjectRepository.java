package com.workflowai.project;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    /** 최근 접근한 프로젝트가 먼저 오도록 정렬한다(온보딩 화면의 유형 프리셋 등에서 사용). */
    @Query("""
        select p from Project p join ProjectMember pm on pm.projectId = p.id
        where pm.userId = :userId
        order by pm.lastAccessedAt desc nulls last, pm.createdAt desc
        """)
    List<Project> findAllByMemberUserId(@Param("userId") Long userId);

    Optional<Project> findFirstByTitle(String title);

    Optional<Project> findByInviteCode(String inviteCode);
}
