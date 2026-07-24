package com.workflowai.evaluation;

import java.math.BigDecimal;

/**
 * 팀원 본인이 마이페이지에서 조회하는 공개된 평가 결과. 세 영역(기여 점수/총합·심사자점수·학점/
 * 심사 코멘트)은 서로 독립적으로 공개되므로, 각각 별도의 revealed 플래그와 값을 내려준다.
 * 공개되지 않은 영역은 해당 revealed가 false이고 값은 항상 null이다.
 * score(AI 기여 점수)와 totalScore(학점 계산기 최종 총합)는 서로 다른 컬럼이다 —
 * 과거엔 같은 컬럼을 공유해서 학점 계산기 저장 시 기여 점수가 총합으로 덮어써졌다.
 */
public record MyEvaluationResponse(
    boolean contributionRevealed,
    BigDecimal score,
    boolean finalRevealed,
    BigDecimal totalScore,
    BigDecimal reviewerScore,
    String grade,
    boolean commentRevealed,
    String comment
) {
    static MyEvaluationResponse notRevealed() {
        return new MyEvaluationResponse(false, null, false, null, null, null, false, null);
    }

    static MyEvaluationResponse from(EvaluationScore entity) {
        return new MyEvaluationResponse(
            entity.isContributionPublic(),
            entity.isContributionPublic() ? entity.getScore() : null,
            entity.isFinalPublic(),
            entity.isFinalPublic() ? entity.getTotalScore() : null,
            entity.isFinalPublic() ? entity.getReviewerScore() : null,
            entity.isFinalPublic() ? entity.getGrade() : null,
            entity.isCommentPublic(),
            entity.isCommentPublic() ? entity.getComment() : null
        );
    }
}
