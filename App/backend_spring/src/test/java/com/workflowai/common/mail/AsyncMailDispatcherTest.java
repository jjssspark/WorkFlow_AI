package com.workflowai.common.mail;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class AsyncMailDispatcherTest {

    private static final Executor SYNCHRONOUS_EXECUTOR = Runnable::run;

    @Test
    void sendsImmediatelyWhenNoActiveTransactionSynchronization() {
        MailSender mailSender = mock(MailSender.class);
        when(mailSender.send(any(), any(), any())).thenReturn(true);
        AsyncMailDispatcher dispatcher = new AsyncMailDispatcher(mailSender, SYNCHRONOUS_EXECUTOR);

        dispatcher.sendAfterCommit("a@example.com", "제목", "본문");

        verify(mailSender).send("a@example.com", "제목", "본문");
    }

    @Test
    void deferSendUntilAfterCommitWhenTransactionSynchronizationIsActive() {
        MailSender mailSender = mock(MailSender.class);
        when(mailSender.send(any(), any(), any())).thenReturn(true);
        AsyncMailDispatcher dispatcher = new AsyncMailDispatcher(mailSender, SYNCHRONOUS_EXECUTOR);

        TransactionSynchronizationManager.initSynchronization();
        try {
            dispatcher.sendAfterCommit("a@example.com", "제목", "본문");

            verifyNoInteractions(mailSender);

            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(mailSender).send(eq("a@example.com"), eq("제목"), eq("본문"));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void doesNotPropagateExceptionWhenExecutorRejects() {
        MailSender mailSender = mock(MailSender.class);
        Executor rejectingExecutor = runnable -> {
            throw new RejectedExecutionException("queue full");
        };
        AsyncMailDispatcher dispatcher = new AsyncMailDispatcher(mailSender, rejectingExecutor);

        assertThatCode(() -> dispatcher.sendAfterCommit("a@example.com", "제목", "본문"))
            .doesNotThrowAnyException();
        verify(mailSender, never()).send(any(), any(), any());
    }

    @Test
    void doesNotPropagateExceptionWhenMailSenderThrows() {
        MailSender mailSender = mock(MailSender.class);
        when(mailSender.send(any(), any(), any())).thenThrow(new RuntimeException("socket timeout"));
        AsyncMailDispatcher dispatcher = new AsyncMailDispatcher(mailSender, SYNCHRONOUS_EXECUTOR);

        assertThatCode(() -> dispatcher.sendAfterCommit("a@example.com", "제목", "본문"))
            .doesNotThrowAnyException();
    }
}
