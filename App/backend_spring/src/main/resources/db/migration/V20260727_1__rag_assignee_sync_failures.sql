-- RagAssigneeSyncFailure 엔티티(com.workflowai.rag.RagAssigneeSyncFailure)가 매핑하는 테이블이
-- db/init 스키마와 이전 마이그레이션 어디에도 없어서, 이 테이블을 갖지 않은 환경(신규 배포 포함)에서는
-- Hibernate 스키마 검증(ddl-auto=validate)이 기동 시점에 항상 실패했다.
CREATE TABLE IF NOT EXISTS rag_assignee_sync_failures (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    source_type   VARCHAR(50) NOT NULL,
    source_id     BIGINT NOT NULL,
    assignee_id   BIGINT,
    error_message TEXT,
    failed_at     TIMESTAMP NOT NULL
);
