package com.workflowai.auth;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, Long> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /**
     * 검사와 소비 사이의 틈을 DB 조건부 갱신으로 닫는다. 동시에 같은 토큰이 들어오면 한쪽만 1을 받는다.
     */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE PasswordResetToken t SET t.usedAt = CURRENT_TIMESTAMP "
        + "WHERE t.id = :tokenId AND t.usedAt IS NULL")
    int consumeIfUnused(@Param("tokenId") Long tokenId);

    /**
     * 재설정에 성공한 시점에 유효한 다른 토큰이 남아 있으면 안 되므로 한 번에 닫는다.
     */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE PasswordResetToken t SET t.usedAt = CURRENT_TIMESTAMP "
        + "WHERE t.userId = :userId AND t.usedAt IS NULL")
    int invalidateAllUnusedByUserId(@Param("userId") Long userId);
}
