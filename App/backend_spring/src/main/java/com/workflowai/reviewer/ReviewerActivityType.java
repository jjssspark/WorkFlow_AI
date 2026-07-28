package com.workflowai.reviewer;

/**
 * 심사자 홈 "최근 심사 활동" 카드에 표시할 활동 종류.
 *
 * <p>표시 문구(label)는 DB에 저장하지 않고 여기서만 관리한다 — 문구를 바꿔야 할 때
 * 이미 쌓인 활동 기록을 손대지 않아도 되고, 저장된 값은 타입만 남아 의미가 안정적이다.
 */
public enum ReviewerActivityType {
    PROJECT_ACCESS("프로젝트 접속"),
    EVALUATION_SCORE_SAVED("기여도 점수 저장"),
    EVALUATION_FINALIZED("평가 확정"),
    EVALUATION_UNFINALIZED("평가 확정 취소");

    private final String label;

    ReviewerActivityType(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
