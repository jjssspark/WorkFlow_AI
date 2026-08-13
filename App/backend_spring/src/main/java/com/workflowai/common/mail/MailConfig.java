package com.workflowai.common.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * {@code workflow.mail.enabled=true}일 때만 실제 SMTP로 보낸다. 기본값은 false —
 * 자격증명 없이 뜬 환경이 조용히 메일을 흘리지 않게 하려면 켜는 쪽이 명시적이어야 한다.
 */
@Configuration
public class MailConfig {
    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    // Bean 이름을 mailSender로 두면 spring.mail.host 프로퍼티 키가(빈 문자열이라도) 존재하는 한
    // Spring Boot의 MailSenderPropertiesConfiguration이 등록하는 JavaMailSenderImpl 빈과 이름이
    // 충돌해 BeanDefinitionOverrideException으로 컨텍스트 기동이 실패한다. 타입 기반 주입만
    // 쓰므로 이름 충돌만 피하면 된다.
    @Bean
    public MailSender workflowMailSender(
        @Value("${workflow.mail.enabled:false}") boolean enabled,
        @Value("${workflow.mail.from:}") String from,
        org.springframework.beans.factory.ObjectProvider<JavaMailSender> javaMailSenderProvider
    ) {
        JavaMailSender javaMailSender = javaMailSenderProvider.getIfAvailable();
        if (!enabled || javaMailSender == null || from.isBlank()) {
            log.warn("메일 발송이 비활성 상태다 (workflow.mail.enabled={}, from 설정={}). "
                + "재설정 메일은 로그로만 출력된다.", enabled, !from.isBlank());
            return new LoggingMailSender();
        }
        log.info("SMTP 메일 발송 활성화: from={}", from);
        return new SmtpMailSender(javaMailSender, from);
    }
}
