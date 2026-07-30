package com.workflowai.activity;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

/**
 * activities.target_id는 판별 컬럼이 없는 폴리모픽이다 — 업무 활동은 task id를, 평가 활동은
 * 평가 대상 학생의 user id를 같은 컬럼에 넣는다. tasks.id와 users.id는 둘 다 BIGSERIAL이라
 * 작은 값 구간에서 반드시 겹치므로, 업무 활동 로그를 target_id만으로 조회하면 학생의 평가
 * 활동("○○님의 학점을 공개했습니다")이 업무 상세 화면에 섞여 나온다. 업무 상세는
 * @projectAccess.isMember라 팀원 전원이 본다.
 */
@DataJpaTest
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class ActivityRepositoryTest {

    private static final Long PROJECT_ID = 1L;
    private static final Long OTHER_PROJECT_ID = 2L;
    private static final Long REVIEWER_ID = 100L;
    /** 업무 id이자, 하필 같은 숫자를 가진 학생의 user id. 이 충돌이 이 테스트의 전부다. */
    private static final Long COLLIDING_ID = 7L;

    @Autowired
    private ActivityRepository activityRepository;

    @Test
    void taskActivityLogExcludesEvaluationActivitiesThatShareTheTargetId() {
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "TASK_UPDATED", COLLIDING_ID, "'로그인 API' 업무 정보를 수정했습니다."
        ));
        // user_id=7인 학생의 학점 공개. target_id가 업무 7과 같은 값이다.
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "GRADE_PUBLISHED", COLLIDING_ID, "박지수님의 학점을 공개했습니다."
        ));
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "REVIEW_COMMENT_SAVED", COLLIDING_ID, "박지수님에 대한 심사 코멘트를 작성했습니다."
        ));

        List<Activity> found = activityRepository.findByProjectIdAndTargetIdAndTypeNotInOrderByCreatedAtDesc(
            PROJECT_ID, COLLIDING_ID, ActivityTypes.NON_TASK_TARGET
        );

        assertThat(found).extracting(Activity::getType).containsExactly("TASK_UPDATED");
    }

    @Test
    void taskActivityLogExcludesActivitiesFromAnotherProjectWithTheSameTargetId() {
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "TASK_CREATED", COLLIDING_ID, "'로그인 API' 업무를 새로 추가했습니다."
        ));
        activityRepository.save(new Activity(
            OTHER_PROJECT_ID, REVIEWER_ID, "TASK_CREATED", COLLIDING_ID, "'남의 프로젝트 업무'를 새로 추가했습니다."
        ));

        List<Activity> found = activityRepository.findByProjectIdAndTargetIdAndTypeNotInOrderByCreatedAtDesc(
            PROJECT_ID, COLLIDING_ID, ActivityTypes.NON_TASK_TARGET
        );

        assertThat(found).extracting(Activity::getMessage)
            .containsExactly("'로그인 API' 업무를 새로 추가했습니다.");
    }

    @Test
    void reviewerRecentActivitiesBreakTiesByIdSoTheOrderIsStableAcrossRequests() {
        // 점수 저장 직후 확정처럼 같은 초에 여러 건이 쌓이면 created_at만으로는 순서가
        // 정해지지 않아 요청마다 목록이 흔들린다.
        Activity first = activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "CONTRIBUTION_SCORE_PUBLISHED", 7L, "박지수님의 기여 점수를 공개했습니다."
        ));
        Activity second = activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "EVALUATION_FINALIZED", null, "프로젝트 평가를 확정했습니다."
        ));

        List<Activity> found = activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDescIdDesc(
            REVIEWER_ID, ActivityTypes.REVIEWER_EVALUATION
        );

        assertThat(found).extracting(Activity::getId).containsExactly(second.getId(), first.getId());
    }

    @Test
    void reviewerRecentActivitiesExcludeTaskActivitiesOfTheSameReviewer() {
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "TASK_UPDATED", 7L, "'로그인 API' 업무 정보를 수정했습니다."
        ));
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "PROJECT_ACCESS", null, "프로젝트에 접속했습니다."
        ));
        activityRepository.save(new Activity(
            PROJECT_ID, REVIEWER_ID, "GRADE_PUBLISHED", 7L, "박지수님의 학점을 공개했습니다."
        ));

        List<Activity> found = activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDescIdDesc(
            REVIEWER_ID, ActivityTypes.REVIEWER_EVALUATION
        );

        assertThat(found).extracting(Activity::getType).containsExactly("GRADE_PUBLISHED");
    }
}
