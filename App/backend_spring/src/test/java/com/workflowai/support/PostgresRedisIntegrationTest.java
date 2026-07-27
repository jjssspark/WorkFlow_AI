package com.workflowai.support;

import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 실제 Postgres·Redis 위에서 전체 애플리케이션을 띄우는 통합 테스트의 공통 베이스.
 *
 * <p>목·스텁으로 대체하면 드러나지 않는 것들 - 스키마 판정 SQL의 실제 결과, 보안 필터 체인을
 * 통과한 뒤의 응답 형태, 트랜잭션 커밋 이후에 도는 후처리 - 을 검증하는 테스트가 여기를 상속한다.
 *
 * <p><strong>@Testcontainers/@Container를 쓰지 않는다.</strong> 그 조합은 클래스마다 afterAll에서
 * 컨테이너를 정지시킨다. 하위 클래스가 여럿이면 클래스가 바뀔 때마다 빈 DB가 새로 떠서, 앞 클래스가
 * 만들어 둔 스키마가 사라진다. 대신 여기서 직접 한 번만 기동하고 JVM이 끝날 때까지 살려 둔다.
 * 명시적으로 stop하지 않아도 Testcontainers의 Ryuk 컨테이너가 JVM 종료 시 정리한다.
 *
 * <p>컨테이너를 공유하는 대가로 하위 클래스는 다른 테스트가 남긴 데이터를 전제하면 안 된다.
 * 필요한 데이터는 각자 준비하고, 고유한 식별자(이메일·제목 등)를 써서 서로 밟지 않게 한다.
 *
 * <p>스키마는 {@link ProductionSchemaFixture}가 운영과 같은 경로(db/init → Flyway)로 만든다.
 * Hibernate가 엔티티에서 만들어내는 스키마는 운영에 실제로 배포되는 스키마와 다를 수 있다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIf("com.workflowai.support.PostgresRedisIntegrationTest#dockerAvailable")
public abstract class PostgresRedisIntegrationTest {

    protected static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    protected static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    private static boolean started = false;

    /** Docker가 없는 환경에서는 실패가 아니라 건너뛴다. 컨테이너 생성자는 Docker 없이도 안전하다. */
    static boolean dockerAvailable() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void integrationProperties(DynamicPropertyRegistry registry) {
        // 컨텍스트가 뜨기 전에 컨테이너와 스키마가 모두 준비돼 있어야 한다. 큐 워커가
        // ApplicationRunner이고 DemoDataService도 기동 중 DB를 읽기 때문이다.
        ensureStarted();

        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));

        // 스키마는 fixture가 운영과 같은 경로로 이미 만들었다. Hibernate가 여기에 손대면
        // 검증 대상이 "운영 스키마"가 아니라 "엔티티에서 생성된 스키마"가 된다.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");

        // application.yml의 기본값도 false지만 ${SPRING_FLYWAY_ENABLED:false}라 환경변수로 뒤집힌다.
        // 여기서 고정해 셸·CI 환경에 따라 테스트 동작이 달라지지 않게 한다.
        // (켜지더라도 fixture가 남긴 flyway_schema_history 때문에 실제로는 no-op이다.)
        registry.add("spring.flyway.enabled", () -> "false");

        // 기본값이 없는 필수 프로퍼티. 없으면 플레이스홀더 해석 단계에서 기동이 실패한다.
        registry.add("workflow.jwt.secret", () -> "test-secret-key-for-integration-tests-32bytes-minimum-length");
        registry.add("workflow.ai.internal-key", () -> "test-internal-key");
    }

    /** 컨테이너 기동과 스키마 구축은 JVM당 한 번이면 된다. 여러 컨텍스트가 생겨도 여기로 모인다. */
    private static synchronized void ensureStarted() {
        if (started) {
            return;
        }
        POSTGRES.start();
        REDIS.start();
        ProductionSchemaFixture.apply(POSTGRES);
        started = true;
    }
}
