package com.workflowai.project;

/**
 * 심사자 평가 진행 상태. DB의 chk_projects_eval_status가 허용하는 값과 1:1이다.
 *
 * <p>DONE("평가 완료")이 한때 있었으나 저장하는 코드 경로가 없었고 운영 DB의 CHECK 제약도
 * 허용하지 않았다. 저장을 시도하면 런타임에 제약 위반이 나므로 2026-07-29에 제거했다.
 * 평가 확정은 EVALUATING에서 PUBLISHED로 바로 전이한다.
 */
public enum EvalStatus {
    PENDING, EVALUATING, PUBLISHED;

    /** 프론트엔드 MyPage.tsx의 EvalStatus 타입("pending"|"evaluating"|"published")과 맞춘 변환. */
    public String toJson() {
        return switch (this) {
            case PENDING -> "pending";
            case EVALUATING -> "evaluating";
            case PUBLISHED -> "published";
        };
    }
}
