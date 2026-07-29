package com.workflowai.project;

import org.springframework.http.HttpStatus;

/**
 * 초대 수락이 실패한 <strong>이유</strong>를 코드로 구분해 나른다.
 *
 * <p>예전에는 컨트롤러가 {@code IllegalArgumentException}을 전부 404/INVITE_NOT_FOUND로,
 * {@code IllegalStateException}을 전부 409로 바꿨다. 그러면 서비스가 의도해서 던진 것과 그 아래
 * 어딘가에서 우연히 터진 것을 구분할 수 없다 - 예컨대 내부 검증이 IllegalArgumentException을
 * 던지면 클라이언트는 "그런 초대 없음"으로 받고, 프론트엔드는 그 404를 신호로 참여 코드 폴백을
 * 시도한다. 진짜 결함이 "유효하지 않은 초대 코드"로 위장되는 것이다.
 *
 * <p>그래서 초대 흐름이 의도적으로 알리는 실패만 이 타입으로 던지고, 나머지 예외는 손대지 않고
 * 그대로 500으로 흘려보낸다. 결함은 결함으로 보여야 한다.
 */
public class InvitationException extends RuntimeException {
    private final String code;
    private final HttpStatus status;

    private InvitationException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    /**
     * 토큰에 해당하는 초대가 없다. 프론트엔드는 <strong>이 코드일 때만</strong> "이건 이메일/링크
     * 초대 토큰이 아니라 프로젝트 참여 코드였다"고 보고 참여 코드로 폴백해야 한다.
     */
    public static InvitationException notFound() {
        return new InvitationException(HttpStatus.NOT_FOUND, "INVITE_NOT_FOUND", "초대를 찾을 수 없습니다.");
    }

    /** 이미 수락되었거나 만료 처리된 초대. 토큰 자체는 실재하므로 폴백 대상이 아니다. */
    public static InvitationException alreadyProcessed() {
        return new InvitationException(HttpStatus.CONFLICT, "INVITE_ALREADY_PROCESSED", "이미 처리된 초대입니다.");
    }

    /** 기한이 지난 초대. 사용자에게 "새 링크를 받으라"고 안내할 수 있게 재사용과 코드를 구분한다. */
    public static InvitationException expired() {
        return new InvitationException(HttpStatus.CONFLICT, "INVITE_EXPIRED", "만료된 초대입니다.");
    }

    public String getCode() {
        return code;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
