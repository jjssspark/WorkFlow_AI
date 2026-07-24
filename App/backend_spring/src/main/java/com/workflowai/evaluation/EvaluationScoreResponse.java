package com.workflowai.evaluation;

import java.math.BigDecimal;

public record EvaluationScoreResponse(
    Long projectId,
    Long userId,
    BigDecimal score,
    BigDecimal totalScore,
    boolean contributionPublic,
    boolean finalPublic,
    boolean commentPublic,
    BigDecimal reviewerScore,
    String grade,
    String comment
) {
    static EvaluationScoreResponse from(EvaluationScore entity) {
        return new EvaluationScoreResponse(
            entity.getProjectId(),
            entity.getUserId(),
            entity.getScore(),
            entity.getTotalScore(),
            entity.isContributionPublic(),
            entity.isFinalPublic(),
            entity.isCommentPublic(),
            entity.getReviewerScore(),
            entity.getGrade(),
            entity.getComment()
        );
    }
}
