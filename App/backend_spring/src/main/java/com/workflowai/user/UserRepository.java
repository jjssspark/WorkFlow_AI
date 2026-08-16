package com.workflowai.user;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Lock;
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

    /**
     * 비밀번호를 바꾸는 쪽이 잡는 배타 잠금.
     *
     * <p>리프레시 토큰 폐기는 "passwordChangedAt보다 이전에 발급된 토큰을 거부한다"는 시각 비교로
     * 이뤄지는데, 시각을 기록한 순간과 커밋되는 순간 사이에 도착한 재발급 요청은 아직 옛 값을 읽는다.
     * 그렇게 만들어진 토큰은 기준 시각보다 뒤라서 변경 후에도 살아남는다. 시각을 언제 찍든 이 창은
     * 닫히지 않으므로, 읽는 쪽({@link #findByIdForShare})과 잠금으로 직렬화한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id")
    Optional<User> findByIdForUpdate(@Param("id") Long id);

    /**
     * 재발급이 잡는 공유 잠금. 비밀번호 변경이 진행 중이면 커밋까지 기다렸다가 갱신된
     * passwordChangedAt을 읽는다. 공유 잠금이라 재발급끼리는 서로 막지 않는다.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT u FROM User u WHERE u.id = :id")
    Optional<User> findByIdForShare(@Param("id") Long id);

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
