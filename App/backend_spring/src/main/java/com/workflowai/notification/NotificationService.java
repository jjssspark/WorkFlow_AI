package com.workflowai.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** TaskController 등이 업무 생성/수정/삭제/이동 시 알림을 남기기 위해 쓰는 공용 서비스. ActivityService와 같은 포지션. */
@Service
public class NotificationService {
    private final NotificationRepository notificationRepository;
    private final NotificationAsyncSender asyncSender;

    public NotificationService(NotificationRepository notificationRepository, NotificationAsyncSender asyncSender) {
        this.notificationRepository = notificationRepository;
        this.asyncSender = asyncSender;
    }

    public void notify(Long userId, String type, String title, String content, String targetType, Long targetId) {
        notificationRepository.save(new Notification(userId, type, title, content, targetType, targetId));
    }

    /**
     * 알림 발송은 부가 기능이라 실패해도 본 트랜잭션을 막으면 안 되고, 트랜잭션이 실제로 커밋되기
     * 전에는 나가면 안 된다. 트랜잭션 동기화가 걸려 있으면 afterCommit 콜백으로 미뤄서 커밋 이후에만
     * 보내고, 그 안에서도 REQUIRES_NEW로 감싸 독립된 새 물리 트랜잭션에서 커밋되도록 강제한다
     * (PR #196에서 확립: afterCommit()은 원 트랜잭션 자원이 언바인딩되기 전에 실행되므로 기본 전파로
     * 저장하면 실제로 커밋되지 않을 위험이 있다). 동기화가 없는 컨텍스트(단위 테스트 등)에서는 즉시
     * best-effort로 보낸다.
     */
    public void notifyAfterCommit(Long userId, String type, String title, String content, String targetType, Long targetId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    asyncSender.sendAsync(userId, type, title, content, targetType, targetId);
                }
            });
            return;
        }
        asyncSender.sendSafely(userId, type, title, content, targetType, targetId);
    }

    /**
     * 행위자 본인 + 반대편(주로 프로젝트 팀장, 또는 팀장이 행위자일 때는 관련 팀원)에게 각각 다른
     * 타입/문구로 알림을 보낸다. 두 사용자가 동일인이면 중복 발송을 피하기 위해 행위자 알림 1건만 보낸다.
     */
    public void notifyActorAndCounterpart(
        Long actorUserId, String actorType, String actorTitle, String actorContent,
        Long counterpartUserId, String counterpartType, String counterpartTitle, String counterpartContent,
        String targetType, Long targetId
    ) {
        if (actorUserId != null) {
            notifyAfterCommit(actorUserId, actorType, actorTitle, actorContent, targetType, targetId);
        }
        if (counterpartUserId != null && !counterpartUserId.equals(actorUserId)) {
            notifyAfterCommit(counterpartUserId, counterpartType, counterpartTitle, counterpartContent, targetType, targetId);
        }
    }
}
