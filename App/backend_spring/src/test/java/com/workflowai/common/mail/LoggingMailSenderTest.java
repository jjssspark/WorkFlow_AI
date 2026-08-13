package com.workflowai.common.mail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LoggingMailSenderTest {

    @Test
    @DisplayName("로그 구현체는 항상 성공을 반환한다")
    void send_alwaysTrue() {
        MailSender sender = new LoggingMailSender();

        assertThat(sender.send("a@example.com", "제목", "본문")).isTrue();
    }

    @Test
    @DisplayName("수신자가 비면 실패로 본다")
    void send_blankRecipient_false() {
        MailSender sender = new LoggingMailSender();

        assertThat(sender.send("  ", "제목", "본문")).isFalse();
    }
}
