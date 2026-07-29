package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.support.PostgresRedisIntegrationTest;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code Project.year}의 {@code @Column(name = "`year`")} 매핑이 실제 Postgres에서
 * 정상적으로 라운드트립되는지 검증한다.
 *
 * <p>{@code year}는 H2에서는 예약어라 quoted identifier로 매핑해뒀다(Project.java 참고).
 * 이 매핑이 Postgres에서도 실제로 동작하는지는 이 리포지토리에서 지금까지 어떤 테스트도
 * 검증하지 않았다 - {@code ProductionSchemaMigrationTest}는 Flyway DDL만 검증하고 엔티티를
 * 저장하지 않으며, H2 {@code @DataJpaTest}는 Postgres가 아니다. "H2에서는 통과하는데 실제
 * Postgres에서는 깨진다"는 이 저장소에 실제로 있었던 사고 패턴이라, quoted identifier
 * 매핑 자체를 실제 Postgres 라운드트립으로 고정한다.
 *
 * <p>영속성 컨텍스트를 {@code clear()}한 뒤 다시 조회해 1차 캐시가 결과를 만들어내지
 * 않게 하고, {@link JdbcTemplate}로 물리 컬럼 값도 별도로 확인해 Hibernate 계층을 완전히
 * 우회한 지점에서도 값이 실제로 저장됐음을 증명한다.
 */
class ProjectYearPersistenceIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String PROJECT_TITLE = "연도 필드 라운드트립 검증 프로젝트";

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanUp() {
        jdbcTemplate.update("DELETE FROM projects WHERE title = ?", PROJECT_TITLE);
    }

    @Test
    void yearSurvivesARealPostgresRoundTripThroughTheHibernateMapping() {
        Project project = new Project(
            PROJECT_TITLE, "캡스톤디자인", 2026, "설명",
            null, null, null, null, null, null, null, null, null
        );
        Long id = projectRepository.saveAndFlush(project).getId();

        // 1차 캐시를 비워, 아래 조회가 방금 저장한 자바 객체를 그대로 돌려주는 게 아니라
        // Postgres에 실제로 SELECT를 다시 날려 quoted "year" 컬럼을 읽어오게 만든다.
        entityManager.clear();

        Project reloaded = projectRepository.findById(id).orElseThrow();
        assertThat(reloaded.getYear()).isEqualTo(2026);

        // Hibernate 계층을 완전히 우회해 물리 컬럼 값 자체도 확인한다.
        Integer rawYear = jdbcTemplate.queryForObject(
            "SELECT year FROM projects WHERE id = ?", Integer.class, id
        );
        assertThat(rawYear).isEqualTo(2026);
    }
}
