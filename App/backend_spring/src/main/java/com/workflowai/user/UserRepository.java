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
     * 이 트랜잭션에서만 유효한 잠금 대기 상한을 건다. 잠금을 잡기 <em>전에</em> 불러야 한다.
     *
     * <p>PostgreSQL 기본값은 무기한 대기다. 그대로 두면 잠금을 기다리는 요청이 커넥션을 붙든 채
     * 멈춰 있고, 커넥션 풀이 작아서(4) 소수의 동시 요청만으로 무관한 사용자까지 커넥션을 못 받는다.
     *
     * <p>SET LOCAL이 아니라 set_config(..., true)를 쓰는 이유는 두 가지다. SET은 값에 바인드
     * 파라미터를 못 쓰고, 세 번째 인자 true가 "이 트랜잭션에서만"을 뜻한다. 트랜잭션 범위여야
     * Supavisor 같은 트랜잭션 풀러에서 다른 클라이언트로 설정이 새지 않는다.
     */
    @Query(value = "SELECT set_config('lock_timeout', :timeout, true)", nativeQuery = true)
    String applyLockTimeout(@Param("timeout") String timeout);

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
