package com.workflowai.support;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import org.flywaydb.core.Flyway;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.testcontainers.containers.Container;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.images.builder.Transferable;

/**
 * 통합 테스트용 스키마를 운영과 동일한 경로로 구축한다.
 *
 * <p>운영 DB는 db/init 스크립트로 base 스키마를 만든 뒤 Flyway가 그 위에 증분 마이그레이션을 얹는
 * 2단 구조다. 테스트에서 Hibernate ddl-auto로 스키마를 만들면 이 경로를 통째로 건너뛴다. 그러면
 * 엔티티와 일치하는 스키마가 생기므로 테스트는 통과하지만, 정작 운영에 배포되는 마이그레이션이
 * 실제로 적용되는지는 한 번도 확인되지 않는다. readiness처럼 "스키마가 준비됐는가"를 판정하는
 * 코드는 그 차이에 정면으로 걸리므로 여기서는 운영과 같은 경로를 쓴다.
 *
 * <p>baselineVersion을 {@value #BASELINE_VERSION}로 두는 이유: 이 버전 이하의 마이그레이션 내용은
 * init 스크립트가 이미 반영해 둔 상태다. baseline 없이 migrate하면 같은 DDL을 두 번 실행해 실패한다.
 * 운영에서도 같은 기준으로 baseline을 잡고 있다.
 */
public final class ProductionSchemaFixture {

    private static final String BASELINE_VERSION = "20260721.1";

    private ProductionSchemaFixture() {
    }

    /** 컨테이너에 base 스키마와 마이그레이션을 순서대로 적용한다. Spring 컨텍스트 기동 전에 호출해야 한다. */
    public static void apply(PostgreSQLContainer<?> postgres) {
        runInitScripts(postgres);
        migrate(postgres);
    }

    private static void runInitScripts(PostgreSQLContainer<?> postgres) {
        Resource[] scripts = loadInitScripts();
        // 파일명 앞의 번호가 곧 적용 순서다. 리소스 조회 순서는 보장되지 않으므로 직접 정렬한다.
        Arrays.sort(scripts, Comparator.comparing(Resource::getFilename));
        for (Resource script : scripts) {
            executeScript(postgres, script);
        }
    }

    private static Resource[] loadInitScripts() {
        try {
            return new PathMatchingResourcePatternResolver().getResources("classpath:db/init/*.sql");
        } catch (IOException exception) {
            throw new IllegalStateException("db/init 스크립트를 읽지 못했다", exception);
        }
    }

    private static void executeScript(PostgreSQLContainer<?> postgres, Resource script) {
        String fileName = script.getFilename();
        try {
            byte[] content = script.getContentAsString(StandardCharsets.UTF_8).getBytes(StandardCharsets.UTF_8);
            String target = "/tmp/workflow-init-" + fileName;
            postgres.copyFileToContainer(Transferable.of(content, 0644), target);

            // ON_ERROR_STOP=1이 없으면 psql이 실패한 문장을 건너뛰고 0으로 종료한다.
            // 스키마가 반쯤 만들어진 채로 테스트가 진행되면 원인 파악이 어려워지므로 첫 오류에서 멈춘다.
            Container.ExecResult result = postgres.execInContainer(
                "psql", "--set", "ON_ERROR_STOP=1",
                "--username", postgres.getUsername(),
                "--dbname", postgres.getDatabaseName(),
                "--file", target
            );
            if (result.getExitCode() != 0) {
                throw new IllegalStateException(
                    "db/init 스크립트 실패: " + fileName + System.lineSeparator() + result.getStderr()
                );
            }
        } catch (IOException exception) {
            throw new IllegalStateException("db/init 스크립트 실행 실패: " + fileName, exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("db/init 스크립트 실행 중 인터럽트: " + fileName, exception);
        }
    }

    private static void migrate(PostgreSQLContainer<?> postgres) {
        Flyway.configure()
            .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion(BASELINE_VERSION)
            .load()
            .migrate();
    }
}
