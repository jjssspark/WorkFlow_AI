package com.workflowai.common.mail;

import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 메일 발송을 HTTP 응답 경로와 DB 트랜잭션 밖으로 뺀다.
 *
 * <p>{@code @Async}를 쓰지 않는다. 이 클래스는 afterCommit 콜백 안에서 (자신이 등록한) 작업을
 * 실행하는 구조인데, {@code @Async}는 프록시로 동작하므로 자기 호출(self-invocation)이나
 * 콜백 내부 호출에서는 프록시를 타지 않고 조용히 동기 실행될 수 있다. 그러면 이 클래스가 고치려는
 * "메일 발송이 응답 경로를 막는다"는 문제가 테스트로도 잘 안 잡히는 채로 그대로 남는다. Executor를
 * 직접 주입받아 {@code execute()}로 넘기면 이 함정이 없고, 큐가 가득 찼을 때의 거부 처리도 명시적으로
 * 드러난다.
 */
@Component
public class AsyncMailDispatcher {
    private static final Logger log = LoggerFactory.getLogger(AsyncMailDispatcher.class);

    private final MailSender mailSender;
    private final Executor mailExecutor;

    public AsyncMailDispatcher(MailSender mailSender, @Qualifier("mailExecutor") Executor mailExecutor) {
        this.mailSender = mailSender;
        this.mailExecutor = mailExecutor;
    }

    /**
     * 트랜잭션 동기화가 활성이면 커밋 후에만 보내고, 없는 컨텍스트(단위 테스트 등)에서는 즉시
     * 제출한다. {@code NotificationService.notifyAfterCommit}과 같은 구조.
     */
    public void sendAfterCommit(String to, String subject, String body) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    submit(to, subject, body);
                }
            });
            return;
        }
        submit(to, subject, body);
    }

    private void submit(String to, String subject, String body) {
        // mailExecutor 큐가 가득 차면 execute()가 이 스레드에서 즉시 RejectedExecutionException을
        // 던진다. afterCommit 콜백은 이미 원 트랜잭션이 커밋된 뒤에 돌기 때문에, 여기서 예외를
        // 흘리면 이미 성공한 API 응답이 500으로 뒤집힌다. 그 500이 곧 "이 계정은 존재한다"는
        // 신호가 되므로 격리한다.
        try {
            mailExecutor.execute(() -> sendSafely(to, subject, body));
        } catch (RuntimeException e) {
            log.error("메일 비동기 작업 제출 실패: to={} subject={}", to, subject, e);
        }
    }

    private void sendSafely(String to, String subject, String body) {
        try {
            boolean sent = mailSender.send(to, subject, body);
            if (!sent) {
                log.error("메일 발송 실패: to={} subject={}", to, subject);
            }
        } catch (RuntimeException e) {
            // SmtpMailSender는 MailException만 잡으므로 소켓 타임아웃 등은 다른 예외로 올라올 수
            // 있다. executor 스레드에서 잡히지 않은 예외는 로그도 없이 사라지므로 여기서 막는다.
            log.error("메일 발송 중 예외 발생: to={} subject={}", to, subject, e);
        }
    }
}
