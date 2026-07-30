package com.workflowai.evaluation;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.activity.ActivityService;
import com.workflowai.support.PostgresRedisIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리뷰 지적사항 검증: {@code ActivityService.record()}가 {@code REQUIRES_NEW}로 독립 커밋되므로,
 * 그 호출을 감싸는 바깥 트랜잭션(예: {@link EvaluationScoreController#upsert}의 {@code
 * @Transactional})이 이후 어떤 이유로든 커밋에 실패해도, 이미 커밋된 활동 로그는 롤백되지
 * 않고 남는다는 사실을 실제 PostgreSQL 트랜잭션으로 확인한다.
 *
 * <p>이건 버그가 아니라 확정된 설계 트레이드오프다({@code ActivityService}의 클래스 주석과
 * {@link EvaluationScoreController#recordEvaluationActivities} 주석 참조 - #470 리뷰 지적
 * 대응으로 "활동 로그 실패가 본 작업을 롤백시키면 안 된다"를 우선한 결과, 그 반대 방향인
 * "본 작업 실패 시 활동 로그도 사라져야 한다"는 만족시킬 수 없다). 이 테스트는 그 트레이드
 * 오프가 실제로 이렇게 동작함을 문서화하고, 향후 누군가 무심코 격리 방식을 바꿔 이 동작이
 * 달라지면(예: 같은 트랜잭션으로 합쳐서 활동 로그 실패가 본 작업을 롤백시키게 되면) 알아채기
 * 위한 회귀 테스트다.
 */
class EvaluationScoreActivityLogTransactionIsolationIntegrationTest extends PostgresRedisIntegrationTest {

    private static final Long PROJECT_ID = 710001L;
    private static final Long LEADER_USER_ID = 710001L;
    private static final Long STUDENT_USER_ID = 710002L;

    @Autowired
    private ActivityService activityService;

    @Autowired
    private org.springframework.transaction.PlatformTransactionManager transactionManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void seedProjectAndUsers() {
        jdbcTemplate.update("DELETE FROM activities WHERE project_id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM project_members WHERE project_id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM projects WHERE id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM users WHERE id IN (?, ?)", LEADER_USER_ID, STUDENT_USER_ID);

        jdbcTemplate.update(
            "INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, 'local', ?)",
            LEADER_USER_ID, "eval-tx-iso-leader@example.com", "검증용 팀장", "eval-tx-iso-leader@example.com"
        );
        jdbcTemplate.update(
            "INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, 'local', ?)",
            STUDENT_USER_ID, "eval-tx-iso-student@example.com", "검증용 학생", "eval-tx-iso-student@example.com"
        );
        jdbcTemplate.update(
            "INSERT INTO projects (id, title, type, created_by) VALUES (?, ?, 'team', ?)",
            PROJECT_ID, "평가 트랜잭션 격리 검증 프로젝트", LEADER_USER_ID
        );
    }

    /**
     * EvaluationScoreController.upsert()가 하는 것과 동일한 순서 - "본 트랜잭션 안에서
     * activityService.record()를 호출한 뒤, 그 트랜잭션 자체는 이후 실패시킨다" -를 그대로
     * 재현한다. 컨트롤러를 거치는 대신 이 순서 자체를 최소 재현으로 직접 만들어, 어떤 이유로
     * 본 트랜잭션이 실패하든(제약 위반, 네트워크 문제 등) 결과가 동일함을 보장한다.
     */
    @Test
    void activityLogSurvivesEvenWhenTheOuterTransactionLaterFails() {
        TransactionTemplate outerTransaction = new TransactionTemplate(transactionManager);

        try {
            outerTransaction.executeWithoutResult(status -> {
                // EvaluationScoreController.upsert()의 recordEvaluationActivities() 호출과
                // 동일한 지점 - 본 트랜잭션이 아직 커밋되지 않은 시점에 활동 로그를 남긴다.
                activityService.record(
                    PROJECT_ID, LEADER_USER_ID, "CONTRIBUTION_SCORE_PUBLISHED", STUDENT_USER_ID,
                    "검증용 학생님의 기여 점수를 공개했습니다."
                );

                // 본 트랜잭션을 강제로 실패시킨다 - 실제로는 유니크 제약 위반/낙관적 락 충돌 등
                // 다양한 이유로 일어날 수 있는 "activityService.record() 이후, 커밋 이전"의
                // 실패를 흉내낸다.
                throw new RuntimeException("본 작업(점수 저장)이 이후 실패하는 상황을 흉내냄");
            });
        } catch (RuntimeException expected) {
            // 본 트랜잭션은 의도대로 실패해 롤백된다.
        }

        // activityService.record()는 REQUIRES_NEW로 별도 물리 트랜잭션에서 이미 커밋됐으므로,
        // 바깥 트랜잭션의 롤백과 무관하게 활동 로그가 남아 있어야 한다 - 이게 확정된 트레이드
        // 오프의 실제 동작이다.
        Long activityCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM activities WHERE project_id = ? AND type = 'CONTRIBUTION_SCORE_PUBLISHED'",
            Long.class, PROJECT_ID
        );
        assertThat(activityCount).isEqualTo(1L);
    }

    /** 대조군: 활동 로그와 본 작업을 하나의 트랜잭션으로 묶으면(REQUIRES_NEW를 안 쓰면)
     * 어떻게 되는지 - 참고용으로, 이 프로젝트가 그 방식을 택하지 않은 이유를 보여준다.
     * (이 테스트 자체는 ActivityService의 실제 동작을 바꾸지 않고, REQUIRED 전파로
     * 별도 실행해 대조만 한다.) */
    @Test
    void demonstratesThatBindingActivityLogToTheSameTransactionWouldRollBackBothTogether() {
        TransactionTemplate requiredTransaction = new TransactionTemplate(transactionManager);
        requiredTransaction.setPropagationBehavior(Propagation.REQUIRED.value());

        try {
            requiredTransaction.executeWithoutResult(status -> {
                jdbcTemplate.update(
                    "INSERT INTO activities (project_id, actor_id, type, target_id, message, created_at) "
                        + "VALUES (?, ?, 'CONTRIBUTION_SCORE_PUBLISHED', ?, ?, now())",
                    PROJECT_ID, LEADER_USER_ID, STUDENT_USER_ID, "같은 트랜잭션으로 묶은 경우 대조군"
                );
                throw new RuntimeException("같은 트랜잭션 안에서 본 작업이 실패하는 상황");
            });
        } catch (RuntimeException expected) {
            // 대조군: 같은 트랜잭션이므로 활동 로그도 함께 롤백돼야 한다.
        }

        Long activityCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM activities WHERE project_id = ? AND type = 'CONTRIBUTION_SCORE_PUBLISHED'",
            Long.class, PROJECT_ID
        );
        assertThat(activityCount).isEqualTo(0L);
    }
}
