package com.workflowai.common.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** SMTP 자격증명이 없는 환경(로컬·테스트)에서 쓰는 기본 구현. 실제로 보내지 않는다. */
public class LoggingMailSender implements MailSender {
    private static final Logger log = LoggerFactory.getLogger(LoggingMailSender.class);

    @Override
    public boolean send(String to, String subject, String body) {
        if (to == null || to.isBlank()) {
            return false;
        }
        // 본문에 재설정 링크가 들어 있어 INFO로 남기면 로그가 곧 자격증명이 된다. 링크가 필요한 개발자는 DEBUG를 켠다.
        log.info("[MAIL:DRY-RUN] to={} subject={}", to, subject);
        log.debug("[MAIL:DRY-RUN] body:\n{}", body);
        return true;
    }
}
