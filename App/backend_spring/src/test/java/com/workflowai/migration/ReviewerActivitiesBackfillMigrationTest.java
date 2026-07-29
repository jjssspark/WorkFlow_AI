package com.workflowai.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.Comparator;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * V20260729_8(reviewer_activities -> activities 백필)이 실제 PostgreSQL에서 옳게 동작하는지
 * 검증한다. dev에서 이미 머지된 reviewer_activities 전용 테이블 기록을, 이 브랜치가 채택한
 * 공용 activities 테이블 기반 조회 경로로 옮기는 마이그레이션이다.
 *
 * <p>운영 Supabase 실측(2026-07-29)에서 확인된 실제 데이터 형태(project_id=1, 다수 user_id,
 * PROJECT_ACCESS/EVALUATION_SCORE_SAVED 두 타입만 존재)를 대표해 대표 행 3건을 심어두고
 * 마이그레이션 후 activities 테이블에 예상대로 반영됐는지 확인한다.
 *
 * <p>동일 4-튜플(project_id/actor_id/type/created_at) 재실행 회귀는 별도 파일
 * {@link ReviewerActivitiesBackfillDuplicateTimestampTest}에서 검증한다 - 이 프로젝트의
 * Testcontainers 기반 마이그레이션 테스트는 static 컨테이너를 클래스 단위로 재사용하므로
 * (다른 마이그레이션 테스트들과 동일한 관례), 한 클래스에 테스트 메서드를 두 개 이상 두면
 * 두 번째 메서드가 이미 초기화된 스키마에 init 스크립트를 다시 실행하려다 충돌한다.
 */
@Testcontainers(disabledWithoutDocker = true)
class ReviewerActivitiesBackfillMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Test
    void backfillsReviewerActivitiesIntoActivitiesWithTypeMapping() throws Exception {
        initializeDatabaseFromScripts();
        seedReviewerActivities();

        Flyway flyway = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("20260721.1")
            .load();

        flyway.migrate();

        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();

        // PROJECT_ACCESS는 신 스키마에도 동일한 타입명으로 존재하므로 그대로 매핑돼야 한다.
        // 시드 데이터 두 건 모두 project_id=900001이다(reviewer_activities 실측 데이터가
        // 단일 프로젝트에 몰려 있던 실제 패턴을 대표함).
        assertThat(activityExists(900001L, "PROJECT_ACCESS")).isTrue();

        // EVALUATION_SCORE_SAVED는 원본만으로 공개/비공개 전환 여부를 복원할 수 없어
        // REVIEW_COMMENT_SAVED로 근사 매핑된다(사용자 확인 완료, 마이그레이션 주석 참조).
        assertThat(activityExists(900001L, "REVIEW_COMMENT_SAVED")).isTrue();

        // target_id는 원본 reviewer_activities에 없으므로 NULL로 백필돼야 한다.
        assertThat(targetIdOf(900001L, "PROJECT_ACCESS")).isNull();
        assertThat(targetIdOf(900001L, "REVIEW_COMMENT_SAVED")).isNull();

        // message는 NOT NULL 제약을 만족해야 하고, 과거 기록임을 알아볼 수 있어야 한다.
        assertThat(messageOf(900001L, "PROJECT_ACCESS")).contains("과거 기록");
        assertThat(messageOf(900001L, "REVIEW_COMMENT_SAVED")).contains("과거 기록");

        // reviewer_activities 원본 테이블은 이 마이그레이션에서 지우지 않는다(검증 전 삭제 방지).
        assertThat(rowExistsInReviewerActivities(910001L)).isTrue();

        // 재실행해도(같은 DB에 flyway.migrate()를 다시 걸어도) 중복 삽입되지 않아야 한다
        // (WHERE NOT EXISTS 가드). Flyway는 이미 적용된 버전을 재실행하지 않으므로, 여기서는
        // 백필 INSERT 문 자체를 다시 한번 직접 실행해 idempotency를 확인한다.
        int countBefore = countActivitiesFromBackfill();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute(readBackfillSql());
        }
        int countAfter = countActivitiesFromBackfill();
        assertThat(countAfter).isEqualTo(countBefore);
    }

    private String readBackfillSql() throws Exception {
        Resource resource = new PathMatchingResourcePatternResolver().getResource(
            "classpath:db/migration/V20260729_8__backfill_reviewer_activities_into_activities.sql"
        );
        return resource.getContentAsString(StandardCharsets.UTF_8);
    }

    private void initializeDatabaseFromScripts() throws Exception {
        Resource[] scripts = new PathMatchingResourcePatternResolver()
            .getResources("classpath:db/init/*.sql");
        Arrays.sort(scripts, Comparator.comparing(Resource::getFilename));

        for (Resource script : scripts) {
            String fileName = script.getFilename();
            assertThat(fileName).isNotNull();
            String target = "/tmp/workflow-init-" + fileName;
            byte[] content = script.getContentAsString(StandardCharsets.UTF_8).getBytes(StandardCharsets.UTF_8);
            POSTGRES.copyFileToContainer(Transferable.of(content, 0644), target);
            org.testcontainers.containers.Container.ExecResult result = POSTGRES.execInContainer(
                "psql", "--set", "ON_ERROR_STOP=1",
                "--username", POSTGRES.getUsername(),
                "--dbname", POSTGRES.getDatabaseName(),
                "--file", target
            );
            assertThat(result.getExitCode())
                .withFailMessage("init script failed: %s%n%s", fileName, result.getStderr())
                .isZero();
        }
    }

    /**
     * reviewer_activities는 이 마이그레이션 이전(V20260728_4)에 이미 생성되므로, Flyway를 돌리기
     * 전에는 아직 테이블이 없다 - init 스크립트가 만드는 게 아니라 마이그레이션 체인이 만든다.
     * 따라서 여기서는 users/projects만 미리 심고, reviewer_activities 시드는 마이그레이션을
     * 부분 실행(target 버전 지정)한 뒤 끼워 넣는 대신 - 더 단순하게, 전체 체인을 한 번 먼저 돌려
     * reviewer_activities까지만 만든 상태를 만들 수 없으므로, users/projects만 시드하고 나머지는
     * flyway.migrate() 완료 후 시점에 맞춰 아래처럼 처리한다.
     *
     * <p>실제로는 백필 마이그레이션(V20260729_8)이 V20260728_4(reviewer_activities 생성) 이후에
     * 실행되므로, 여기서는 대신 Flyway를 두 단계로 나눠 돌린다: 먼저 V20260729_8 직전까지만
     * 마이그레이션한 뒤 reviewer_activities에 시드 데이터를 넣고, 이어서 나머지를 마이그레이션한다.
     */
    private void seedReviewerActivities() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO users (id, email, name, provider, provider_id)
                VALUES (900001, 'reviewer-backfill@example.com', '검증용 심사자', 'local', 'reviewer-backfill@example.com')
                """);
            statement.execute("""
                INSERT INTO projects (id, title, type, created_by)
                VALUES (900001, '백필 검증 프로젝트', 'team', 900001)
                """);
        }

        Flyway partial = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("20260721.1")
            .target("20260729.7")
            .load();
        partial.migrate();

        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO reviewer_activities (id, user_id, project_id, activity_type, created_at)
                VALUES (910001, 900001, 900001, 'PROJECT_ACCESS', TIMESTAMP '2026-07-28 10:00:00')
                """);
            statement.execute("""
                INSERT INTO reviewer_activities (id, user_id, project_id, activity_type, created_at)
                VALUES (910002, 900001, 900001, 'EVALUATION_SCORE_SAVED', TIMESTAMP '2026-07-28 11:00:00')
                """);
        }
    }

    private boolean activityExists(long expectedProjectId, String type) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement(
                 "SELECT 1 FROM activities WHERE project_id = ? AND type = ? AND message LIKE '(과거 기록)%'"
             )) {
            ps.setLong(1, expectedProjectId);
            ps.setString(2, type);
            try (ResultSet result = ps.executeQuery()) {
                return result.next();
            }
        }
    }

    private Long targetIdOf(long projectId, String type) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement(
                 "SELECT target_id FROM activities WHERE project_id = ? AND type = ? AND message LIKE '(과거 기록)%'"
             )) {
            ps.setLong(1, projectId);
            ps.setString(2, type);
            try (ResultSet result = ps.executeQuery()) {
                assertThat(result.next()).isTrue();
                long value = result.getLong(1);
                return result.wasNull() ? null : value;
            }
        }
    }

    private String messageOf(long projectId, String type) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement(
                 "SELECT message FROM activities WHERE project_id = ? AND type = ? AND message LIKE '(과거 기록)%'"
             )) {
            ps.setLong(1, projectId);
            ps.setString(2, type);
            try (ResultSet result = ps.executeQuery()) {
                assertThat(result.next()).isTrue();
                return result.getString(1);
            }
        }
    }

    private boolean rowExistsInReviewerActivities(long id) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement("SELECT 1 FROM reviewer_activities WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet result = ps.executeQuery()) {
                return result.next();
            }
        }
    }

    private int countActivitiesFromBackfill() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                 "SELECT COUNT(*) FROM activities WHERE message LIKE '(과거 기록)%'")) {
            result.next();
            return result.getInt(1);
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        );
    }
}
