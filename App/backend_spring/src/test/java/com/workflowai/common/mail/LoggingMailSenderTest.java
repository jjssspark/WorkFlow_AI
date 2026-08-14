package com.workflowai.common.mail;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class LoggingMailSenderTest {

    private Logger logbackLogger;
    private ListAppender<ILoggingEvent> appender;
    private Level originalLevel;

    @BeforeEach
    void attachAppender() {
        logbackLogger = (Logger) LoggerFactory.getLogger(LoggingMailSender.class);
        originalLevel = logbackLogger.getLevel();
        logbackLogger.setLevel(Level.INFO);
        appender = new ListAppender<>();
        appender.start();
        logbackLogger.addAppender(appender);
    }

    @AfterEach
    void detachAppender() {
        logbackLogger.detachAppender(appender);
        logbackLogger.setLevel(originalLevel);
    }

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

    @Test
    @DisplayName("INFO 레벨 로그에는 본문(재설정 링크)이 노출되지 않는다")
    void send_bodyNotLoggedAtInfo() {
        MailSender sender = new LoggingMailSender();
        String secretToken = "RESET-TOKEN-8f3c9a1e";

        sender.send("a@example.com", "제목", "본문 링크: " + secretToken);

        assertThat(appender.list)
            .extracting(ILoggingEvent::getFormattedMessage)
            .noneMatch(message -> message.contains(secretToken));
    }
}
