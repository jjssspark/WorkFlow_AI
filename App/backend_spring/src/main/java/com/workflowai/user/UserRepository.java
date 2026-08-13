package com.workflowai.user;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByProviderAndProviderId(String provider, String providerId);

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    Optional<User> findFirstByName(String name);

    List<User> findAllByNameAndAffiliation(String name, String affiliation);

    Page<User> findAllByReviewerStatus(ReviewerStatus reviewerStatus, Pageable pageable);

    @Transactional
    @Modifying
    @Query("UPDATE User u SET u.reviewerStatus = com.workflowai.user.ReviewerStatus.APPROVED, u.updatedAt = CURRENT_TIMESTAMP "
        + "WHERE u.id = :userId AND u.reviewerStatus = com.workflowai.user.ReviewerStatus.PENDING")
    int approveIfPending(@Param("userId") Long userId);

    @Transactional
    @Modifying
    @Query("UPDATE User u SET u.reviewerStatus = com.workflowai.user.ReviewerStatus.REJECTED, "
        + "u.reviewerRejectionReason = :reason, u.updatedAt = CURRENT_TIMESTAMP "
        + "WHERE u.id = :userId AND u.reviewerStatus = com.workflowai.user.ReviewerStatus.PENDING")
    int rejectIfPending(@Param("userId") Long userId, @Param("reason") String reason);
}
