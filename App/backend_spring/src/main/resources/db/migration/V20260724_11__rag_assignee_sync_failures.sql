-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.
--
-- 버그 수정: RagAssigneeSyncFailure 엔티티(com.workflowai.rag)에 대응하는 테이블이
-- init/migration 스크립트 어디에도 없어, 새로 생성한 DB에서는 Hibernate 스키마 검증이
-- "missing table [rag_assignee_sync_failures]"로 실패해 애플리케이션이 기동조차 되지
-- 않았다(코드 리뷰로 발견). Supabase(팀 공유 DB)에는 이미 이 테이블이 존재해 실제로는
-- 드러나지 않았던 결함이다 — 여기서는 Supabase의 실제 스키마를 그대로 반영한다.

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
