package com.workflowai.evaluation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/** 프로젝트별 학점 계산기 점수 비율 설정. project_id가 PK — 프로젝트당 설정 1건. */
@Entity
@Table(name = "evaluation_settings")
public class EvaluationSetting {
    @Id
    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "contribution_ratio", nullable = false, precision = 5, scale = 2)
    private BigDecimal contributionRatio;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected EvaluationSetting() {
    }

    public EvaluationSetting(Long projectId, BigDecimal contributionRatio) {
        this.projectId = projectId;
        this.contributionRatio = contributionRatio;
    }

    @PrePersist
    @PreUpdate
    void onSave() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getProjectId() {
        return projectId;
    }

    public BigDecimal getContributionRatio() {
        return contributionRatio;
    }

    public void setContributionRatio(BigDecimal contributionRatio) {
        this.contributionRatio = contributionRatio;
    }
}
