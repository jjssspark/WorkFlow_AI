CREATE TABLE IF NOT EXISTS rag_assignee_sync_failures (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id BIGINT NOT NULL,
  assignee_id BIGINT,
  error_message TEXT,
  failed_at TIMESTAMP NOT NULL
);
