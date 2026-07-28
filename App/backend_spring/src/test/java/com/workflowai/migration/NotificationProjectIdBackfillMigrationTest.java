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
 * V20260728_1(project_id 백필)과 V20260728_2(NULL 잔존 행 삭제)가 PostgreSQL-only UPDATE ... FROM
 * 구문을 쓰기 때문에 H2 리포지토리 테스트(spring.flyway.enabled=false)로는 한 번도 실제로 실행된 적이
 * 없다. 실제 Postgres에 각 target_type(task/meeting/milestone/evaluation/project)의 대표 행을 심어두고
 * 마이그레이션을 돌려, 백필이 옳게 복원하는지와 복원 불가능한 project 알림이 삭제되는지를 검증한다.
 */
@Testcontainers(disabledWithoutDocker = true)
class NotificationProjectIdBackfillMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Test
    void backfillsProjectIdByTargetTypeAndDeletesUnrecoverableRows() throws Exception {
        initializeDatabaseFromScripts();
        seedNotificationsForEachTargetType();

        Flyway flyway = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("20260721.1")
            .load();

        flyway.migrate();

        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();

        // task/meeting/milestone/evaluation 알림은 원본 행을 역추적해 project_id가 복원돼야 한다.
        assertThat(projectIdOf(910001)).isEqualTo(900001L);
        assertThat(projectIdOf(910002)).isEqualTo(900001L);
        assertThat(projectIdOf(910003)).isEqualTo(900001L);
        assertThat(projectIdOf(910004)).isEqualTo(900001L);

        // target_id가 애초에 NULL인 project(진행률 보고서) 알림은 복원할 원본이 없어 V20260728_2가
        // 삭제한다 - project_id가 영구히 NULL인 채로 남아 어떤 조회 경로에도 안 보이고 정리 쿼리에도
        // 안 걸리는 상태가 되는 걸 막는다.
        assertThat(rowExists(910005)).isFalse();

        // 백필 시점에 이미 삭제된 task를 가리키던 알림(target_id가 더 이상 tasks에 없음)도 JOIN이
        // 매칭되지 않아 project_id가 NULL로 남으므로 V20260728_2가 함께 삭제해야 한다.
        assertThat(rowExists(910006)).isFalse();

        assertThat(countRowsWithNullProjectId()).isZero();
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
     * project_id 컬럼은 아직 없는(=마이그레이션 실행 전) 상태의 notifications에, target_type별 대표
     * 행을 하나씩 심는다. 이 시점의 notifications 스키마는 02_meeting_ai_additions.sql 그대로다.
     */
    private void seedNotificationsForEachTargetType() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO users (id, email, name, provider, provider_id)
                VALUES (900001, 'legacy-notif@example.com', '레거시 사용자', 'local', 'legacy-notif@example.com')
                """);
            statement.execute("""
                INSERT INTO projects (id, title, type, created_by)
                VALUES (900001, '알림 백필 검증', 'team', 900001)
                """);
            statement.execute("""
                INSERT INTO milestones (id, project_id, title, due_date)
                VALUES (900001, 900001, '검증용 마일스톤', DATE '2026-07-31')
                """);
            statement.execute("""
                INSERT INTO tasks (
                    id, project_id, milestone_id, title, category, status, position, created_at, updated_at
                ) VALUES (
                    900001, 900001, 900001, '검증용 업무', 'backend', 'todo', 0,
                    TIMESTAMP '2026-07-20 09:00:00', TIMESTAMP '2026-07-20 09:00:00'
                )
                """);
            statement.execute("""
                INSERT INTO meetings (id, project_id, title, file_type, analysis_status, created_at)
                VALUES (900001, 900001, '검증용 회의록', 'document', 'completed', TIMESTAMP '2026-07-20 09:00:00')
                """);
            statement.execute("""
                INSERT INTO evaluation_scores (id, project_id, user_id, score, contribution_public)
                VALUES (900001, 900001, 900001, 90.00, true)
                """);

            // target_type='task', 원본 tasks.id=900001이 존재 -> project_id=900001로 복원돼야 함.
            insertLegacyNotification(statement, 910001, "task", 900001L);
            // target_type='meeting' -> meetings.id=900001을 역추적.
            insertLegacyNotification(statement, 910002, "meeting", 900001L);
            // target_type='milestone' -> milestones.id=900001을 역추적.
            insertLegacyNotification(statement, 910003, "milestone", 900001L);
            // target_type='evaluation' -> target_id 자체가 project_id(EvaluationScoreController 참조).
            insertLegacyNotification(statement, 910004, "evaluation", 900001L);
            // target_type='project'(진행률 보고서) -> target_id가 애초에 NULL, 복원 불가 -> 삭제 대상.
            insertLegacyNotification(statement, 910005, "project", null);
            // target_type='task'인데 target_id가 가리키는 task가 존재하지 않음(백필 전 이미 삭제된
            // 원본을 흉내) -> JOIN 불일치로 project_id 복원 불가 -> 역시 삭제 대상.
            insertLegacyNotification(statement, 910006, "task", 999999L);
        }
    }

    private void insertLegacyNotification(Statement statement, long id, String targetType, Long targetId)
        throws SQLException {
        String targetIdSql = targetId == null ? "NULL" : String.valueOf(targetId);
        statement.execute("""
            INSERT INTO notifications (id, user_id, type, title, content, target_type, target_id, is_read)
            VALUES (%d, 900001, 'TEST_TYPE', '검증용 알림', '검증용 본문', '%s', %s, false)
            """.formatted(id, targetType, targetIdSql));
    }

    private Long projectIdOf(long notificationId) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement("SELECT project_id FROM notifications WHERE id = ?")) {
            ps.setLong(1, notificationId);
            try (ResultSet result = ps.executeQuery()) {
                assertThat(result.next()).withFailMessage("알림 id=%d가 존재하지 않음", notificationId).isTrue();
                long value = result.getLong(1);
                return result.wasNull() ? null : value;
            }
        }
    }

    private boolean rowExists(long notificationId) throws SQLException {
        try (Connection connection = connection();
             var ps = connection.prepareStatement("SELECT 1 FROM notifications WHERE id = ?")) {
            ps.setLong(1, notificationId);
            try (ResultSet result = ps.executeQuery()) {
                return result.next();
            }
        }
    }

    private int countRowsWithNullProjectId() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                 "SELECT COUNT(*) FROM notifications WHERE project_id IS NULL")) {
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
