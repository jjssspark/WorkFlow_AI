package com.workflowai.reviewer;

import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReviewerActivityService {
    private static final Logger log = LoggerFactory.getLogger(ReviewerActivityService.class);
    /** 심사자 홈 사이드 카드에 들어가는 분량. 화면이 4~5줄이라 이 정도면 넉넉하다. */
    private static final int RECENT_ACTIVITY_LIMIT = 10;

    private final ReviewerActivityRepository reviewerActivityRepository;
    private final ProjectRepository projectRepository;
    private final TransactionTemplate requiresNewTransactionTemplate;

    public ReviewerActivityService(
        ReviewerActivityRepository reviewerActivityRepository,
        ProjectRepository projectRepository,
        PlatformTransactionManager transactionManager
    ) {
        this.reviewerActivityRepository = reviewerActivityRepository;
        this.projectRepository = projectRepository;
        this.requiresNewTransactionTemplate = new TransactionTemplate(transactionManager);
        this.requiresNewTransactionTemplate.setPropagationBehavior(TransactionTemplate.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 활동 기록. 기록 실패가 평가 확정/점수 저장 같은 본 작업을 되돌리면 안 되므로 예외를 삼키고
     * 로그만 남긴다 — 이 기록은 홈 화면 표시용 부가 데이터다.
     *
     * <p>선언적 @Transactional(REQUIRES_NEW)만으로는 부족하다 — EvaluationScoreController.upsert()
     * 처럼 호출자 자체가 @Transactional이어도 record()가 별도 트랜잭션에서 돌긴 하지만,
     * Spring Data JPA의 save() 역시 자체 트랜잭션 경계를 가져 record()의 트랜잭션에 REQUIRED로
     * 합류한다. save()가 던진 예외가 그 경계를 빠져나가는 순간 record()의 트랜잭션이
     * rollback-only로 마킹되고, 커밋은 record() 메서드 바디가 이미 반환된 뒤 AOP 프록시에서
     * 일어나므로 메서드 안의 try/catch로는 그 시점의 UnexpectedRollbackException을 잡을 수
     * 없다(회귀 테스트로 실측 확인). TransactionTemplate을 쓰면 커밋이 executeWithoutResult()
     * 호출 안에서 동기적으로 일어나 같은 메서드의 try/catch로 커밋 실패까지 잡을 수 있다.
     */
    public void record(Long userId, Long projectId, ReviewerActivityType activityType) {
        try {
            requiresNewTransactionTemplate.executeWithoutResult(status ->
                reviewerActivityRepository.save(new ReviewerActivity(userId, projectId, activityType))
            );
        } catch (RuntimeException e) {
            log.error("심사자 활동 기록 실패: userId={}, projectId={}, type={}", userId, projectId, activityType, e);
        }
    }

    @Transactional(readOnly = true)
    public ReviewerActivityHomeResponse getHomeActivities(Long userId) {
        List<ReviewerActivity> recent = reviewerActivityRepository
            .findAllByUserIdOrderByCreatedAtDescIdDesc(userId, PageRequest.of(0, RECENT_ACTIVITY_LIMIT));
        List<ReviewerActivityRepository.ProjectLastAccessView> lastAccessViews =
            reviewerActivityRepository.findLastAccessByUserId(userId);

        // 활동에 등장하는 프로젝트 제목을 한 번에 읽어온다(활동 건마다 조회하면 N+1이 된다).
        List<Long> projectIds = recent.stream().map(ReviewerActivity::getProjectId).distinct().toList();
        Map<Long, String> titleByProjectId = projectRepository.findAllById(projectIds).stream()
            .collect(Collectors.toMap(Project::getId, Project::getTitle));

        List<ReviewerActivityHomeResponse.Activity> activities = recent.stream()
            .map(activity -> new ReviewerActivityHomeResponse.Activity(
                activity.getProjectId(),
                // 프로젝트가 삭제됐어도 활동 기록은 남는다. 카드에서 줄이 통째로 사라지는 대신
                // 제목만 대체 문구로 채워, 언제 무엇을 했는지는 계속 보이게 한다.
                titleByProjectId.getOrDefault(activity.getProjectId(), "삭제된 프로젝트"),
                activity.getActivityType().name(),
                activity.getActivityType().label(),
                activity.getCreatedAt()
            ))
            .toList();

        List<ReviewerActivityHomeResponse.LastAccess> lastAccess = lastAccessViews.stream()
            .map(view -> new ReviewerActivityHomeResponse.LastAccess(view.getProjectId(), view.getLastAccessedAt()))
            .toList();

        return new ReviewerActivityHomeResponse(activities, lastAccess);
    }
}
