package com.workflowai.common.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

/** AWS SES SMTP 발송. */
public class SmtpMailSender implements MailSender {
    private static final Logger log = LoggerFactory.getLogger(SmtpMailSender.class);

    private final JavaMailSender javaMailSender;
    private final String from;

    public SmtpMailSender(JavaMailSender javaMailSender, String from) {
        this.javaMailSender = javaMailSender;
        this.from = from;
    }

    @Override
    public boolean send(String to, String subject, String body) {
        if (to == null || to.isBlank()) {
            return false;
        }
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject(subject);
            message.setText(body);
            javaMailSender.send(message);
            return true;
        } catch (org.springframework.mail.MailException e) {
            // 수신자 주소는 로그에 남기되 본문은 남기지 않는다(재설정 링크가 로그로 새면 안 된다).
            log.error("메일 발송 실패: to={} subject={}", to, subject, e);
            return false;
        }
    }
}
