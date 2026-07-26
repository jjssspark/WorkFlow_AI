-- ============================================================================
-- 버그 수정: RagAssigneeSyncFailure 엔티티(com.workflowai.rag)에 대응하는 테이블이
-- init/migration 스크립트 어디에도 없어, 새로 생성한 DB에서는 Hibernate 스키마 검증이
-- "missing table [rag_assignee_sync_failures]"로 실패했다(코드 리뷰로 발견).
-- 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
-- ============================================================================

CREATE TABLE IF NOT EXISTS rag_assignee_sync_failures (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    source_type   VARCHAR(50) NOT NULL,
    source_id     BIGINT NOT NULL,
    assignee_id   BIGINT,
    error_message TEXT,
    failed_at     TIMESTAMP NOT NULL
);

COMMENT ON TABLE rag_assignee_sync_failures IS 'RAG 인덱싱 시 담당자(assignee) 동기화에 실패한 이력';
