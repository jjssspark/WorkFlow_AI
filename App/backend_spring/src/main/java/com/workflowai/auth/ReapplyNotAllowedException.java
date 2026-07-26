package com.workflowai.auth;

/** REJECTED 상태가 아닌 계정(PENDING, APPROVED, 신청 이력 없음)이 재신청을 시도할 때 던진다. */
public class ReapplyNotAllowedException extends RuntimeException {
    public ReapplyNotAllowedException() {
        super("재신청은 거부된 심사자 신청만 가능합니다.");
    }
}
