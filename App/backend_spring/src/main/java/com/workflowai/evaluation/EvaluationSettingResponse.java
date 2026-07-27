package com.workflowai.evaluation;

import java.math.BigDecimal;

public record EvaluationSettingResponse(Long projectId, BigDecimal contributionRatio) {
    private static final BigDecimal DEFAULT_CONTRIBUTION_RATIO = new BigDecimal("40.00");

    static EvaluationSettingResponse from(EvaluationSetting entity) {
        return new EvaluationSettingResponse(entity.getProjectId(), entity.getContributionRatio());
    }

    /** 아직 설정을 저장한 적 없는 프로젝트는 기본값(기여 40% / 심사자 60%)을 반환한다. */
    static EvaluationSettingResponse defaultFor(Long projectId) {
        return new EvaluationSettingResponse(projectId, DEFAULT_CONTRIBUTION_RATIO);
    }
}
