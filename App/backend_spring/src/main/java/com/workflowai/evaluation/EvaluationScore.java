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

    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal score;

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
