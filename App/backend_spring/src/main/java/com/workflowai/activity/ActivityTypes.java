package com.workflowai.activity;

import java.util.List;

/**
 * activities.type 상수 모음.
 *
 * <p>{@code activities.target_id}는 판별 컬럼이 없는 폴리모픽이다 — 업무(task) id가 들어가는
 * 활동과 평가 대상 학생의 user id가 들어가는 활동이 같은 컬럼을 쓴다. {@code tasks.id}와
 * {@code users.id}는 둘 다 BIGSERIAL이라 작은 값 구간에서 반드시 겹치므로, target_id만으로
 * 조회하면 업무 활동 로그에 남의 평가 활동이 섞여 나온다. 조회하는 쪽이 타입으로 걸러야 한다.
 */
public final class ActivityTypes {
    private ActivityTypes() {
    }

    /** 심사자가 프로젝트에 진입할 때. target_id 없음(null). */
    public static final String PROJECT_ACCESS = "PROJECT_ACCESS";

    /**
     * 심사자가 남기는 평가 활동. 점수/학점 공개 전환과 코멘트 저장은 target_id에 평가 대상
     * 학생의 user id가 들어가고, 평가 확정/취소는 특정 학생 대상이 아니라 null이다.
     */
    public static final List<String> REVIEWER_EVALUATION = List.of(
        "CONTRIBUTION_SCORE_PUBLISHED", "CONTRIBUTION_SCORE_UNPUBLISHED",
        "GRADE_PUBLISHED", "GRADE_UNPUBLISHED",
        "REVIEW_COMMENT_SAVED",
        "EVALUATION_FINALIZED", "EVALUATION_UNFINALIZED"
    );

    /**
     * target_id가 업무 id가 <b>아닌</b> 활동 타입 전체. 업무 활동 로그 조회에서 제외 목록으로 쓴다.
     * 화이트리스트(업무 타입 열거)가 아니라 블랙리스트인 이유: 과거에 쓰였다가 지금은 코드에
     * 없는 업무 활동 타입(STATUS_CHANGED 등)이 DB에 남아 있어도 이력에서 사라지지 않게 하려고.
     */
    public static final List<String> NON_TASK_TARGET = concat(REVIEWER_EVALUATION, PROJECT_ACCESS);

    private static List<String> concat(List<String> types, String extra) {
        return java.util.stream.Stream.concat(types.stream(), java.util.stream.Stream.of(extra)).toList();
    }
}
