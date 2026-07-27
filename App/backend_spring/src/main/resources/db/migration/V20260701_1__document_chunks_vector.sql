-- document_chunks.embedding: JSONB -> VECTOR(768) (nomic-embed-text 차원)
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 전제: document_chunks에 데이터 없음(2026-07-15 확인) — 데이터 변환 불필요, 컬럼 타입 재정의만 수행

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE VECTOR(768) USING NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_document_chunks_project
  ON document_chunks (project_id, source_type);
