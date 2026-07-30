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
 * 리뷰 지적사항 검증: V20260729_8 백필 마이그레이션에서, 같은 사람이 같은 프로젝트에서 같은
 * 타입 활동을 정확히 같은 타임스탬프(초 단위까지 동일)에 두 번 남긴 "진짜 서로 다른 두 활동"이,
 * 백필이 부분적으로만 반영된 상태(예: 이전 실행이 둘 중 하나만 넣고 중단된 상황)에서
 * 재실행됐을 때 두 번째 행이 유실되지 않고 정확히 복구되는지 확인한다.
 *
 * <p>project_id/actor_id/type/created_at 4개 값만으로 "이미 백필됐는지"를 판정하면
 * NOT EXISTS가 "튜플이 하나라도 있는가"만 보고 "몇 개나 있어야 하는가"는 확인하지 못해,
 * 두 번째 이후 행이 영구히 누락될 수 있다(로컬 재현으로 최초 확인함 - PARTITION BY
 * project_id/actor_id/type/created_at + ROW_NUMBER()로 순번까지 맞춰 비교하도록 수정).
 * 이 테스트가 그 회귀를 잡는다.
 *
 * <p>{@link ReviewerActivitiesBackfillMigrationTest}와 별도 파일로 분리한 이유: 이 프로젝트의
 * Testcontainers 기반 마이그레이션 테스트는 static 컨테이너를 클래스 단위로 재사용하는 관례라
 * (ProductionSchemaMigrationTest/NotificationProjectIdBackfillMigrationTest 모두 클래스당
 * 테스트 메서드 1개), 한 클래스에 메서드를 두 개 두면 두 번째 메서드가 이미 초기화된 스키마에
 * init 스크립트를 다시 실행하려다 충돌한다.
 */
@Testcontainers(disabledWithoutDocker = true)
class ReviewerActivitiesBackfillDuplicateTimestampTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Test
    void recoversTheMissingRowWhenBackfillWasPartiallyAppliedForDuplicateTimestampActivities() throws Exception {
        initializeDatabaseFromScripts();
        seedReviewerActivitiesWithDuplicateTimestamp();

        Flyway flyway = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("20260721.1")
            .load();
        flyway.migrate();

        // 최초 실행: 동일 타임스탬프의 두 PROJECT_ACCESS 행이 모두 백필돼야 한다(유실 없음).
        assertThat(countActivitiesOfType("PROJECT_ACCESS")).isEqualTo(2);

        // 부분 실행 흉내: 방금 백필된 두 건 중 하나를 지워, "이전 실행이 하나만 넣고 중단된"
        // 상태를 재현한다.
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                DELETE FROM activities
                WHERE project_id = 900001 AND type = 'PROJECT_ACCESS' AND message LIKE '(과거 기록)%'
                  AND id = (
                      SELECT id FROM activities
                      WHERE project_id = 900001 AND type = 'PROJECT_ACCESS' AND message LIKE '(과거 기록)%'
                      ORDER BY id LIMIT 1
                  )
                """);
        }
        assertThat(countActivitiesOfType("PROJECT_ACCESS")).isEqualTo(1);

        // 재실행: 누락된 한 건이 정확히 복구돼야 하고(총 2건), 중복이 추가로 생기면 안 된다.
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute(readBackfillSql());
        }
        assertThat(countActivitiesOfType("PROJECT_ACCESS")).isEqualTo(2);

        // 한 번 더 재실행해도(완전 idempotent 상태) 3건, 4건으로 불어나지 않아야 한다.
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute(readBackfillSql());
        }
        assertThat(countActivitiesOfType("PROJECT_ACCESS")).isEqualTo(2);
    }

    private int countActivitiesOfType(String type) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement(
                 "SELECT COUNT(*) FROM activities WHERE project_id = 900001 AND type = ? AND message LIKE '(과거 기록)%'"
             )) {
            ps.setString(1, type);
            try (ResultSet result = ps.executeQuery()) {
                result.next();
                return result.getInt(1);
            }
        }
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
            String target = "/tmp/workflow-init-dup-" + fileName;
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

    /** {@link ReviewerActivitiesBackfillMigrationTest#seedReviewerActivities()}와 같은 패턴이지만,
     * PROJECT_ACCESS 타입 활동을 정확히 같은 타임스탬프로 하나 더 심어 진짜 중복 시나리오를 만든다. */
    private void seedReviewerActivitiesWithDuplicateTimestamp() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO users (id, email, name, provider, provider_id)
                VALUES (900001, 'reviewer-backfill-dup@example.com', '검증용 심사자', 'local', 'reviewer-backfill-dup@example.com')
                """);
            statement.execute("""
                INSERT INTO projects (id, title, type, created_by)
                VALUES (900001, '백필 중복 타임스탬프 검증 프로젝트', 'team', 900001)
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
            // 동일 4-튜플(project_id/user_id/activity_type/created_at)을 갖는 진짜 서로 다른
            // 두 번째 PROJECT_ACCESS 행 - 첫 번째 것과 완전히 같은 시각.
            statement.execute("""
                INSERT INTO reviewer_activities (id, user_id, project_id, activity_type, created_at)
                VALUES (910002, 900001, 900001, 'PROJECT_ACCESS', TIMESTAMP '2026-07-28 10:00:00')
                """);
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        );
    }
}
