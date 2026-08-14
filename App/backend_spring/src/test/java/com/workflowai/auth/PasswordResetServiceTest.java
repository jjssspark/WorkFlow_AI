package com.workflowai.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workflowai.common.mail.AsyncMailDispatcher;
import com.workflowai.common.mail.MailSender;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.Optional;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * requestReset의 메일 발송이 응답 경로 밖(afterCommit)으로 빠지는지를 지키는 단위 테스트.
 * AsyncMailDispatcher는 실물을 쓰고, 그 아래 MailSender만 목킹해서 커밋 전에는 절대 호출되지
 * 않음을 검증한다. 이 테스트가 없으면 나중에 누가 sendAfterCommit을 다시 동기 호출로 되돌려도
 * 스위트가 초록불로 남는다.
 */
@ExtendWith(MockitoExtension.class)
class PasswordResetServiceTest {

    private static final Executor SYNCHRONOUS_EXECUTOR = Runnable::run;

    @Mock
    private UserRepository userRepository;
    @Mock
    private PasswordResetTokenRepository tokenRepository;
    @Mock
    private MailSender mailSender;
    @Mock
    private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    private PasswordResetService newService() {
        AsyncMailDispatcher dispatcher = new AsyncMailDispatcher(mailSender, SYNCHRONOUS_EXECUTOR);
        return new PasswordResetService(
            userRepository, tokenRepository, dispatcher, passwordEncoder, "https://work-flow.example");
    }

    @Test
    void requestResetDoesNotSendMailBeforeTransactionCommits() {
        PasswordResetService service = newService();
        User user = new User(
            "local-reset@example.com", "김로컬", "local", "local-reset@example.com", "hash");
        when(userRepository.findByEmail("local-reset@example.com")).thenReturn(Optional.of(user));
        when(mailSender.send(any(), any(), any())).thenReturn(true);

        TransactionSynchronizationManager.initSynchronization();
        try {
            service.requestReset("local-reset@example.com", "127.0.0.1");

            verifyNoInteractions(mailSender);

            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(mailSender).send(org.mockito.ArgumentMatchers.eq("local-reset@example.com"), any(), any());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void requestResetSendsImmediatelyWhenNoActiveTransactionSynchronization() {
        PasswordResetService service = newService();
        User user = new User(
            "local-reset@example.com", "김로컬", "local", "local-reset@example.com", "hash");
        when(userRepository.findByEmail("local-reset@example.com")).thenReturn(Optional.of(user));
        when(mailSender.send(any(), any(), any())).thenReturn(true);

        service.requestReset("local-reset@example.com", "127.0.0.1");

        verify(mailSender).send(org.mockito.ArgumentMatchers.eq("local-reset@example.com"), any(), any());
    }

    @Test
    void requestResetUnknownAccountNeverTouchesMailSender() {
        PasswordResetService service = newService();
        when(userRepository.findByEmail("nobody@example.com")).thenReturn(Optional.empty());

        service.requestReset("nobody@example.com", "127.0.0.1");

        verifyNoInteractions(mailSender);
    }
}
