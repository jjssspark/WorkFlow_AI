package com.workflowai.admin;

/** 이미 처리된(PENDING이 아닌) 심사자 신청을 다시 승인/거부하려 할 때 던진다. */
public class ReviewerStatusConflictException extends RuntimeException {
    public ReviewerStatusConflictException() {
        super("이미 처리된 심사자 신청입니다.");
    }
}
