package com.workflowai.project;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvitationRepository extends JpaRepository<Invitation, Long> {
    Optional<Invitation> findByToken(String token);

    Optional<Invitation> findFirstByProjectIdAndEmailIsNullAndRoleAndStatusOrderByCreatedAtDesc(
        Long projectId, ProjectRole role, String status
    );
}
