package com.workflowai.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** TaskController 등이 업무 생성/수정/삭제/이동 시 알림을 남기기 위해 쓰는 공용 서비스. ActivityService와 같은 포지션. */
@Service
public class NotificationService {
    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final NotificationRepository notificationRepository;
    private final NotificationAsyncSender asyncSender;

    public NotificationService(NotificationRepository notificationRepository, NotificationAsyncSender asyncSender) {
        this.notificationRepository = notificationRepository;
        this.asyncSender = asyncSender;
    }

    public void notify(Long userId, Long projectId, String type, String title, String content,
                       String targetType, Long targetId) {
        notificationRepository.save(new Notification(userId, projectId, type, title, content, targetType, targetId));
    }

    /**
     * 알림 발송은 부가 기능이라 실패해도 본 트랜잭션을 막으면 안 되고, 트랜잭션이 실제로 커밋되기
     * 전에는 나가면 안 된다. 트랜잭션 동기화가 걸려 있으면 afterCommit 콜백으로 미뤄서 커밋 이후에만
     * 보내고, 그 안에서도 REQUIRES_NEW로 감싸 독립된 새 물리 트랜잭션에서 커밋되도록 강제한다
     * (PR #196에서 확립: afterCommit()은 원 트랜잭션 자원이 언바인딩되기 전에 실행되므로 기본 전파로
     * 저장하면 실제로 커밋되지 않을 위험이 있다). 동기화가 없는 컨텍스트(단위 테스트 등)에서는 즉시
     * best-effort로 보낸다.
     */
    public void notifyAfterCommit(Long userId, Long projectId, String type, String title, String content,
                                  String targetType, Long targetId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    // notificationExecutor 큐가 가득 차면 @Async 프록시의 submit()이
                    // 이 스레드(요청 처리 스레드)에서 즉시 RejectedExecutionException을 던진다.
                    // 원 트랜잭션은 이미 커밋된 뒤라, 여기서 예외를 흘리면 이미 성공한 API 응답이
                    // 실패한 것처럼 보이게 된다 — 알림은 부가 기능이므로 격리한다.
                    try {
                        asyncSender.sendAsync(userId, projectId, type, title, content, targetType, targetId);
                    } catch (RuntimeException e) {
                        log.warn("알림 비동기 작업 제출 실패. userId={}, projectId={}, type={}, targetType={}, targetId={}",
                            userId, projectId, type, targetType, targetId, e);
                    }
                }
            });
            return;
        }
        asyncSender.sendSafely(userId, projectId, type, title, content, targetType, targetId);
    }

    /**
     * 반대편(주로 프로젝트 팀장, 또는 팀장이 행위자일 때는 관련 팀원)에게만 알린다. 행위자 본인은
     * 방금 자기가 한 일의 결과를 화면에서 이미 보고 있으므로 알림을 따로 보내지 않는다.
     * 반대편이 행위자와 동일인이면(예: 팀장이 본인 회의록을 처리) 아무 알림도 나가지 않는다.
     */
    public void notifyCounterpart(
        Long actorUserId, Long counterpartUserId, Long projectId,
        String type, String title, String content,
        String targetType, Long targetId
    ) {
        if (counterpartUserId == null || counterpartUserId.equals(actorUserId)) {
            return;
        }
        notifyAfterCommit(counterpartUserId, projectId, type, title, content, targetType, targetId);
    }
}
