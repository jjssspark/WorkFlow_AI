package com.workflowai.evaluation;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;

/**
 * 심사자가 팀원 최종 평가 점수를 확정/수정할 때 쓰는 요청.
 * score/contributionPublic/finalPublic/commentPublic/reviewerScore/grade/comment는
 * 모두 "null이면 기존 값을 유지"하는 정책이다 — 세 공개 플래그는 서로 독립적으로
 * 토글되므로, 예를 들어 기여 점수 공개만 토글할 때는 finalPublic/commentPublic을
 * 아예 보내지 않아야(null) 다른 화면이 저장한 공개 상태를 덮어쓰지 않는다.
 */
public record EvaluationScoreRequest(
    @NotNull Long projectId,
    @NotNull Long userId,
    @DecimalMin("0") @DecimalMax("100") BigDecimal score,
    Boolean contributionPublic,
    Boolean finalPublic,
    Boolean commentPublic,
    @DecimalMin("0") @DecimalMax("100") BigDecimal reviewerScore,
    @Pattern(
        regexp = "^(A\\+|A|A0|A-|B\\+|B|B0|B-|C\\+|C|C0|C-|D\\+|D|D0|D-|F|P|NP)$",
        message = "학점 형식이 올바르지 않습니다."
    )
    String grade,
    String comment
) {}
