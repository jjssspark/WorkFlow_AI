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

/** 운영 baseline에서 누락될 수 있는 컬럼을 실제 PostgreSQL에 적용해 검증한다. */
@Testcontainers(disabledWithoutDocker = true)
class ProductionSchemaMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Test
    void baselineDatabaseMigratesProfilePlanningAndCompletionColumns() throws Exception {
        initializeDatabaseFromScripts();
        prepareRepresentativeLegacySchema();

        Flyway flyway = Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("20260721.1")
            .load();

        flyway.migrate();

        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(columnExists("users", "affiliation")).isTrue();
        assertThat(columnExists("users", "field_tags")).isTrue();
        assertThat(columnExists("users", "github_username")).isTrue();
        assertThat(columnExists("users", "profile_image_path")).isTrue();
        assertThat(columnExists("users", "terms_agreed_at")).isTrue();
        assertThat(columnExists("users", "privacy_agreed_at")).isTrue();
        assertThat(columnExists("tasks", "done_date")).isTrue();
        assertThat(columnExists("milestones", "start_date")).isTrue();
        assertThat(queryBoolean("SELECT field_tags @> '[\"backend\"]'::jsonb FROM users WHERE id = 900001"))
            .isTrue();
        assertThat(queryBoolean("""
            SELECT is_nullable = 'NO'
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'field_tags'
            """))
            .isTrue();
        assertThat(queryString("SELECT done_date::text FROM tasks WHERE id = 900001"))
            .isEqualTo("2026-07-25");
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

    private void prepareRepresentativeLegacySchema() throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS affiliation");
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS field_tags");
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS github_username");
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS profile_image_path");
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS terms_agreed_at");
            statement.execute("ALTER TABLE users DROP COLUMN IF EXISTS privacy_agreed_at");
            statement.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS field VARCHAR(100)");
            statement.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS done_date");
            statement.execute("ALTER TABLE milestones DROP COLUMN IF EXISTS start_date");

            statement.execute("""
                INSERT INTO users (id, email, name, provider, provider_id, field)
                VALUES (900001, 'legacy@example.com', '레거시 사용자', 'local', 'legacy@example.com', 'backend')
                """);
            statement.execute("""
                INSERT INTO projects (id, title, type, created_by)
                VALUES (900001, '운영 스키마 검증', 'team', 900001)
                """);
            statement.execute("""
                INSERT INTO milestones (id, project_id, title, due_date)
                VALUES (900001, 900001, '기존 마일스톤', DATE '2026-07-31')
                """);
            statement.execute("""
                INSERT INTO tasks (
                    id, project_id, milestone_id, title, category, status, position, created_at, updated_at
                ) VALUES (
                    900001, 900001, 900001, '기존 완료 업무', 'backend', 'done', 0,
                    TIMESTAMP '2026-07-20 09:00:00', TIMESTAMP '2026-07-25 18:30:00'
                )
                """);
        }
    }

    private boolean columnExists(String tableName, String columnName) throws SQLException {
        try (Connection connection = connection();
             var statement = connection.prepareStatement("""
                 SELECT EXISTS (
                     SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
                 )
                 """)) {
            statement.setString(1, tableName);
            statement.setString(2, columnName);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getBoolean(1);
            }
        }
    }

    private boolean queryBoolean(String sql) throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getBoolean(1);
        }
    }

    private String queryString(String sql) throws SQLException {
        try (Connection connection = connection(); Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        );
    }
}
