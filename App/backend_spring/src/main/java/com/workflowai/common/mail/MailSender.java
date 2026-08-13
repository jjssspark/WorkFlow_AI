package com.workflowai.common.mail;

/**
 * 메일 발송.
 *
 * <p>실패해도 예외를 던지지 않고 {@code false}를 반환한다. 계정 복구 흐름에서 발송 실패가
 * 500으로 새어 나가면 그 자체가 "이 계정은 존재한다"는 신호가 되기 때문이다.
 */
public interface MailSender {
    boolean send(String to, String subject, String body);
}
