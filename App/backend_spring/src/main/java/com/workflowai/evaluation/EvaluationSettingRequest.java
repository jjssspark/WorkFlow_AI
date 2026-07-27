package com.workflowai.evaluation;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** 심사자가 학점 계산기의 점수 비율(기여 점수 %)을 저장할 때 쓰는 요청. */
public record EvaluationSettingRequest(
    @NotNull @DecimalMin("0") @DecimalMax("100") BigDecimal contributionRatio
) {}
