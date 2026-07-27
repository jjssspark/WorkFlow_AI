package com.workflowai.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 알림 저장을 호출 스레드에서 분리한다. NotificationService.notifyAfterCommit()의 afterCommit
 * 콜백은 원 트랜잭션이 커밋된 뒤 응답을 반환하기 전에 동기적으로 실행되므로, 여기서 저장을
 * REQUIRES_NEW로 동기 실행하면 API 응답이 그만큼 지연된다(예: 회의록 삭제 시 왕복 지연이 큰
 * DB에서 알림 2건 저장 때문에 응답이 초 단위로 늘어남). 알림은 부가 기능이므로 별도 스레드에서
 * 처리해 응답 경로를 막지 않는다.
 *
 * 저장이 실제로 커밋된 직후(같은 메서드 안에서) broadcaster로 실시간 push까지 함께 한다 —
 * 커밋 전에 push하면 클라이언트가 곧바로 목록을 다시 불러왔을 때 아직 없는 알림을 보게 될 수 있다.
 */
@Component
public class NotificationAsyncSender {
    private static final Logger log = LoggerFactory.getLogger(NotificationAsyncSender.class);

    private final NotificationRepository notificationRepository;
    private final NotificationBroadcaster broadcaster;
    private final TransactionTemplate requiresNewTransaction;

    public NotificationAsyncSender(
        NotificationRepository notificationRepository,
        PlatformTransactionManager transactionManager,
        NotificationBroadcaster broadcaster
    ) {
        this.notificationRepository = notificationRepository;
        this.broadcaster = broadcaster;
        this.requiresNewTransaction = new TransactionTemplate(transactionManager);
        this.requiresNewTransaction.setPropagationBehavior(TransactionTemplate.PROPAGATION_REQUIRES_NEW);
    }

    @Async("notificationExecutor")
    public void sendAsync(Long userId, String type, String title, String content, String targetType, Long targetId) {
        sendSafely(userId, type, title, content, targetType, targetId);
    }

    public void sendSafely(Long userId, String type, String title, String content, String targetType, Long targetId) {
        try {
            Notification saved = requiresNewTransaction.execute(status -> {
                Notification created = notificationRepository.save(
                    new Notification(userId, type, title, content, targetType, targetId));
                notificationRepository.deleteExcessByUserId(userId);
                return created;
            });
            broadcaster.broadcast(userId, NotificationDto.from(saved));
        } catch (Exception e) {
            log.warn("알림 발송 실패. userId={}, type={}, targetType={}, targetId={}", userId, type, targetType, targetId, e);
        }
    }
}
