package com.workflowai.evaluation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "evaluation_scores")
public class EvaluationScore {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    // AI가 산정한 기여 점수(ContributorsView 왼쪽 테이블/기여도 API 값)의 스냅샷.
    // 학점 계산기의 최종 총합(totalScore)과는 별개 컬럼이다 — 과거엔 하나의 score
    // 컬럼을 공유해서, 학점 계산기 저장 시 여기 저장돼 있던 기여 점수가 총합으로
    // 덮어써지는 버그가 있었다(코드 리뷰로 발견, 2026-07-24).
    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal score;

    // 학점 계산기가 계산해 저장하는 최종 총합(기여 점수 × 비율 + 심사자 점수 × 비율).
    // 저장 전(계산기 미사용)에는 null.
    @Column(name = "total_score", precision = 5, scale = 2)
    private BigDecimal totalScore;

    // 세 공개 플래그는 서로 독립적이다 — 심사자가 초/중반에는 기여 점수만 먼저 공개해
    // 진행 상황을 알리고, 최종 확정 시점에만 총합/학점을 공개하는 워크플로를 지원한다.
    @Column(name = "contribution_public", nullable = false)
    private boolean contributionPublic;

    @Column(name = "final_public", nullable = false)
    private boolean finalPublic;

    @Column(name = "comment_public", nullable = false)
    private boolean commentPublic;

    @Column(name = "reviewer_score", precision = 5, scale = 2)
    private BigDecimal reviewerScore;

    @Column(name = "grade", length = 2)
    private String grade;

    @Column(name = "comment", columnDefinition = "TEXT")
    private String comment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected EvaluationScore() {
    }

    public EvaluationScore(Long projectId, Long userId, BigDecimal score, boolean contributionPublic) {
        this.projectId = projectId;
        this.userId = userId;
        this.score = score;
        this.contributionPublic = contributionPublic;
    }

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getUserId() {
        return userId;
    }

    public BigDecimal getScore() {
        return score;
    }

    public void setScore(BigDecimal score) {
        this.score = score;
    }

    public BigDecimal getTotalScore() {
        return totalScore;
    }

    public void setTotalScore(BigDecimal totalScore) {
        this.totalScore = totalScore;
    }

    public boolean isContributionPublic() {
        return contributionPublic;
    }

    public void setContributionPublic(boolean contributionPublic) {
        this.contributionPublic = contributionPublic;
    }

    public boolean isFinalPublic() {
        return finalPublic;
    }

    public void setFinalPublic(boolean finalPublic) {
        this.finalPublic = finalPublic;
    }

    public boolean isCommentPublic() {
        return commentPublic;
    }

    public void setCommentPublic(boolean commentPublic) {
        this.commentPublic = commentPublic;
    }

    public BigDecimal getReviewerScore() {
        return reviewerScore;
    }

    public void setReviewerScore(BigDecimal reviewerScore) {
        this.reviewerScore = reviewerScore;
    }

    public String getGrade() {
        return grade;
    }

    public void setGrade(String grade) {
        this.grade = grade;
    }

    public String getComment() {
        return comment;
    }

    public void setComment(String comment) {
        this.comment = comment;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
