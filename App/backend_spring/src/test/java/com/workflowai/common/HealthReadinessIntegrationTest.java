package com.workflowai.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.support.PostgresRedisIntegrationTest;
import com.workflowai.support.ProductionSchemaFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * IT-001 준비 상태~의존성 연계.
 *
 * <p>readiness는 Redis PING, 큐 워커 생존, DB 스키마 상태를 함께 보고 트래픽 수용 여부를 판정한다.
 * 단위 테스트({@link HealthControllerTest})는 이 넷을 모두 목으로 대체하므로, 스키마 판정 SQL이
 * 실제 스키마에서 맞는 답을 내는지는 검증하지 못한다. 그 SQL이 틀리면 두 방향으로 조용히 깨진다.
 * 조건이 과하면 정상 서버가 영구 503이 되어 배포가 막히고, 조건이 헐거우면 스키마가 덜 준비된
 * 서버에 로드밸런서가 트래픽을 넣는다. 둘 다 실제 Postgres 없이는 드러나지 않는다.
 *
 * <p>스키마를 Hibernate ddl-auto로 만들지 않고 {@link ProductionSchemaFixture}를 쓰는 이유는
 * 그 클래스 주석에 있다. 요약하면 운영은 init 스크립트 + Flyway 경로로 스키마를 만들기 때문이다.
 */
class HealthReadinessIntegrationTest extends PostgresRedisIntegrationTest {

    private static final String READINESS_PATH = "/api/v1/health/ready";
    private static final String SCHEMA_MARKER_TABLE = "rag_assignee_sync_failures";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void reportsUpWhenSchemaAndRedisAreActuallyAvailable() throws Exception {
        mockMvc.perform(get(READINESS_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.status").value("UP"));
    }

    @Test
    void reportsDownWhenTheSchemaMarkerTableIsMissing() throws Exception {
        // DROP 대신 RENAME을 쓴다. 컨텍스트와 컨테이너를 다른 테스트와 공유하므로 원복이 가능해야 하고,
        // DROP 후 재생성은 원본 DDL을 손으로 베껴야 해서 스키마가 바뀌면 이 테스트부터 썩는다.
        renameMarkerTable(SCHEMA_MARKER_TABLE, SCHEMA_MARKER_TABLE + "_hidden");
        try {
            mockMvc.perform(get(READINESS_PATH))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.data.status").value("DOWN"));
        } finally {
            renameMarkerTable(SCHEMA_MARKER_TABLE + "_hidden", SCHEMA_MARKER_TABLE);
        }

        // 원복만으로 다시 UP이 되어야 한다. 그래야 503의 원인이 이 테이블이었음이 증명된다.
        mockMvc.perform(get(READINESS_PATH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("UP"));
    }

    private void renameMarkerTable(String from, String to) {
        jdbcTemplate.execute("ALTER TABLE " + from + " RENAME TO " + to);
    }
}
