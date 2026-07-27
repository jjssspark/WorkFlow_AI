package com.workflowai.auth;

/** REJECTED 상태(관리자가 심사자 신청을 거부)인 계정이 로그인을 시도할 때 던진다. */
public class ReviewerApplicationRejectedException extends RuntimeException {
    public ReviewerApplicationRejectedException(String reason) {
        super(reason != null && !reason.isBlank()
            ? "심사자 신청이 거부되었습니다. 사유: " + reason
            : "심사자 신청이 거부되었습니다.");
    }
}
