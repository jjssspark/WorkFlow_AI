package com.workflowai.activity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 다른 컨트롤러(TaskController, ChecklistController 등)가 실제 동작이 일어날 때 활동 로그를 남기기 위해 쓰는 공용 서비스. */
@Service
public class ActivityService {
    private static final Logger log = LoggerFactory.getLogger(ActivityService.class);

    private final ActivityRepository activityRepository;
    private final TransactionTemplate requiresNewTransactionTemplate;

    public ActivityService(ActivityRepository activityRepository, PlatformTransactionManager transactionManager) {
        this.activityRepository = activityRepository;
        this.requiresNewTransactionTemplate = new TransactionTemplate(transactionManager);
        this.requiresNewTransactionTemplate.setPropagationBehavior(TransactionTemplate.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 활동 기록. 기록 실패가 평가 확정/점수 저장·업무 생성/수정 같은 본 작업을 되돌리면 안 되므로
     * 예외를 삼키고 로그만 남긴다 — 이 기록은 홈/대시보드 표시용 부가 데이터다.
     *
     * <p>선언적 {@code @Transactional(REQUIRES_NEW)}만으로는 부족하다 — 호출자 자체가
     * {@code @Transactional}인 경우(EvaluationScoreController.upsert() 등) record()가 별도
     * 트랜잭션에서 돌긴 하지만, Spring Data JPA의 save() 역시 자체 트랜잭션 경계를 가져
     * record()의 트랜잭션에 REQUIRED로 합류한다. save()가 던진 예외가 그 경계를 빠져나가는
     * 순간 record()의 트랜잭션이 rollback-only로 마킹되고, 커밋은 record() 메서드 바디가 이미
     * 반환된 뒤 AOP 프록시에서 일어나므로 메서드 안의 try/catch로는 그 시점의
     * UnexpectedRollbackException을 잡을 수 없다. TransactionTemplate을 쓰면 커밋이
     * executeWithoutResult() 호출 안에서 동기적으로 일어나 같은 메서드의 try/catch로 커밋
     * 실패까지 잡을 수 있다.
     */
    public void record(Long projectId, Long actorId, String type, Long targetId, String message) {
        try {
            requiresNewTransactionTemplate.executeWithoutResult(status ->
                activityRepository.save(new Activity(projectId, actorId, type, targetId, message))
            );
        } catch (RuntimeException e) {
            log.error(
                "활동 기록 실패: projectId={}, actorId={}, type={}, targetId={}", projectId, actorId, type, targetId, e
            );
        }
    }
}
