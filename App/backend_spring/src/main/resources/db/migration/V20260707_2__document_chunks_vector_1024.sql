-- document_chunks.embedding: VECTOR(768) -> VECTOR(1024)
-- 배경: RAG 챗봇의 임베딩 모델이 Ollama(nomic-embed-text, 768차원)에서
-- Hugging Face(BAAI/bge-m3, 1024차원)로 바뀌었다(embedding_service.py 참고).
-- 차원이 다른 벡터는 호환되지 않으므로, 기존 임베딩 값은 그대로 둘 수 없고
-- 컬럼 타입을 바꾼 뒤 반드시 전체 재임베딩이 필요하다.
--
-- 적용 순서 (반드시 이 순서로):
--   1) 이 마이그레이션 적용 (기존 임베딩 값은 NULL로 초기화됨 — 아래 USING NULL 참고)
--   2) cd App/backend_fastapi && python -m llm_rag_assistant.scripts.reembed_document_chunks
--      (document_chunks 전체를 새 모델로 재임베딩)
--
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
--
-- 재실행 위험(idempotency guard): 이 저장소는 Flyway 등 마이그레이션 이력 추적을
-- 쓰지 않는다(SPRING_FLYWAY_ENABLED 기본 false). 즉 "이미 적용했는지"를 DB가
-- 스스로 기억하지 못하므로, 배포자가 실수로 이 파일을 다시 실행하면 이미
-- 재임베딩까지 끝난 embedding 값이 또다시 전부 NULL로 초기화되어 RAG 검색이
-- 재임베딩 완료 전까지 빈 결과만 반환하게 된다. 아래 DO 블록은 embedding 컬럼이
-- 이미 vector(1024)이면 ALTER를 건너뛰어 이 사고를 방지한다.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
  current_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO current_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'document_chunks'
      AND a.attname = 'embedding'
      AND a.attnum > 0
      AND NOT a.attisdropped;

  IF current_type = 'vector(1024)' THEN
    RAISE NOTICE 'document_chunks.embedding is already vector(1024) — skipping ALTER COLUMN (idempotency guard, see comment above). Re-run reembed_document_chunks manually only if you actually intend to re-embed.';
  ELSE
    -- ivfflat 인덱스는 벡터 차원에 종속되므로 컬럼 타입 변경 전에 먼저 제거한다.
    DROP INDEX IF EXISTS idx_document_chunks_embedding;

    -- 차원이 바뀌면 기존 768차원 벡터는 1024차원 컬럼에 그대로 넣을 수 없으므로
    -- USING NULL로 값을 비운다 (001_document_chunks_vector.sql과 동일한 방식) —
    -- 재임베딩 스크립트가 이후 전체 행을 다시 채운다.
    ALTER TABLE document_chunks
      ALTER COLUMN embedding TYPE VECTOR(1024) USING NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
