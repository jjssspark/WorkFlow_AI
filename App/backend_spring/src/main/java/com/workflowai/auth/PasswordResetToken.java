package com.workflowai.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 비밀번호 재설정 토큰.
 *
 * <p>{@code tokenHash}에는 원문이 아니라 SHA-256 hex(64자)만 들어간다. DB를 읽을 수 있는 사람이
 * 아무 계정이나 탈취하지 못하게 하기 위해서다. 원문은 발송 메일의 링크에만 존재한다.
 */
@Entity
@Table(name = "password_reset_tokens")
public class PasswordResetToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "requested_ip", length = 45)
    private String requestedIp;

    protected PasswordResetToken() {
    }

    public PasswordResetToken(Long userId, String tokenHash, LocalDateTime expiresAt, String requestedIp) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.requestedIp = requestedIp;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public LocalDateTime getUsedAt() {
        return usedAt;
    }

    /**
     * 테스트 픽스처 전용. 프로덕션 코드에서 토큰을 소비할 때는 이 메서드를 쓰지 말고
     * {@link PasswordResetTokenRepository#consumeIfUnused(Long)}를 써야 한다 — 여기서
     * 엔티티 필드만 바꾸고 저장하면 조회와 저장 사이에 동시 요청이 끼어들어 같은 토큰이
     * 두 번 소비되는 레이스를 막지 못한다. consumeIfUnused는 조건부 UPDATE 한 번으로
     * 그 틈을 없앤다.
     */
    public void markUsed() {
        this.usedAt = LocalDateTime.now();
    }

    public boolean isUsable(LocalDateTime now) {
        return usedAt == null && expiresAt.isAfter(now);
    }
}
