-- ============================================================================
-- 생성물 — 직접 편집하지 말 것.
--
-- 왜 필요한가: db/migration의 V20260701_1~V20260713_1(구 docs/db/migrations 001~013)은
-- 운영 baseline(20260721.1)보다 번호가 낮아 Flyway가 'Below Baseline'으로 건너뛴다.
-- 운영에는 이미 적용돼 있어 의도된 동작이지만, 빈 DB로 새로 구축할 때는 이 14개가
-- 아무것도 실행하지 않아 pgvector 확장·embedding vector(1024) 전환·
-- rag_assignee_sync_failures 등이 누락된다.
--
-- 그래서 db/init 마지막 단계(11_)에서 같은 내용을 한 번 더 적용한다. initdb.d는 빈 볼륨에서
-- 단 한 번만 실행되므로 운영 DB에는 영향이 없다.
--
-- 갱신 방법: V20260701_1~V20260713_1을 버전 순서대로 이어붙인다. 새 V파일을 baseline
-- 아래에 추가하는 일은 없어야 하므로, 이 파일은 OCI 이관 시 baseline 재설계와 함께 폐기한다.
-- 관련: docs/decisions/2026-07-26-flyway-single-migration-path.md
-- ============================================================================

-- ---------- V20260701_1__document_chunks_vector.sql ----------
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

-- ---------- V20260702_1__task_position.sql ----------
-- 칸반 카드의 컬럼(status) 내 순서를 저장하기 위한 position 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 정렬 규칙: 같은 status 안에서 position 오름차순. status가 다르면 값이 겹쳐도 무방
--           (프론트가 항상 status로 먼저 필터링한 뒤 렌더링하므로 컬럼 간 값은 서로 비교되지 않음).
-- 초기값 배정: 지금 화면에 보이는 순서(같은 project_id+status 안에서 created_at DESC, 기존 GET 정렬과 동일)를
--            그대로 유지하도록 0, 1, 2...를 배정한다. 이후부터는 드래그로 자유롭게 재배치 가능.

-- 1) 컬럼 추가 (일단 NULL 허용 - 백필 전이라 NOT NULL을 바로 걸 수 없음)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION;

-- 2) 기존 업무에 초기 position 배정
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id, status ORDER BY created_at DESC) - 1 AS rn
  FROM tasks
)
UPDATE tasks
SET position = ranked.rn
FROM ranked
WHERE tasks.id = ranked.id;

-- 3) 백필 완료 후 NOT NULL 제약 추가
ALTER TABLE tasks ALTER COLUMN position SET NOT NULL;

-- ---------- V20260703_1__task_comments.sql ----------
-- 업무(task)에 대한 코멘트를 저장하는 전용 테이블 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 참고: 기존 comments 테이블은 "개인/팀 코멘트"(target_type=personal/team, target_user_id)용으로 따로 설계되어 있어
--       업무 코멘트와 목적이 다르다(task_id 컬럼도 없음). 혼용하지 않고 이 전용 테이블을 새로 둔다.

CREATE TABLE IF NOT EXISTS task_comments (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    author_id  BIGINT NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_comments_task   FOREIGN KEY (task_id)   REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_comments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id);

-- ---------- V20260704_1__activities_message.sql ----------
-- activities 테이블에 사람이 읽을 수 있는 메시지를 저장할 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 전제: activities 테이블은 아직 어떤 백엔드 코드도 쓰지 않아 데이터가 없다(2026-07-16 확인) - 백필 불필요.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE activities ALTER COLUMN message DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_activities_target ON activities (target_id);

-- ---------- V20260705_1__task_comment_type.sql ----------
-- 업무 코멘트를 "일반 코멘트"와 "팀장 피드백"으로 구분하기 위한 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)

ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'COMMENT';
-- type: 'COMMENT' | 'FEEDBACK'

-- ---------- V20260706_1__task_results.sql ----------
-- 업무 상세 "작업 내용 작성" 패널(내용/링크/첨부파일)을 위한 테이블 3종 추가.
-- 적용 대상: 현재 Supabase PostgreSQL

CREATE TABLE IF NOT EXISTS task_results (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL UNIQUE,
    content    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_results_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_results IS '업무당 1개, 작업 내용 작성 upsert';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_results_updated_at') THEN
        CREATE TRIGGER trg_task_results_updated_at
            BEFORE UPDATE ON task_results
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS task_result_links (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    url        TEXT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_links_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_result_links_task ON task_result_links (task_id);

CREATE TABLE IF NOT EXISTS task_result_files (
    id           BIGSERIAL PRIMARY KEY,
    task_id      BIGINT NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL, -- Supabase Storage 내 object 경로 (버킷 하위)
    size         BIGINT NOT NULL,
    content_type VARCHAR(100),
    uploaded_by  BIGINT,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_files_task     FOREIGN KEY (task_id)     REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_result_files_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_result_files_task ON task_result_files (task_id);

-- ---------- V20260707_1__document_chunks_assignee.sql ----------
-- RAG 어시스턴트가 "내가 담당한 업무" 같은 개인화 질문에 답할 수 있도록
-- document_chunks에 담당자 컬럼을 추가하고, 기존 청크의 담당자를 tasks/meeting_action_items에서
-- 조인해 채운다 (meeting 청크는 담당자 개념이 없어 NULL로 남는다).
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 주의: 이 컬럼 없이 배포된 backend-fastapi는 ingest/query에서 assignee_id를 참조하다 실패하므로,
--       코드 배포 전에 반드시 이 마이그레이션을 먼저 적용할 것.

-- 1) 컬럼 추가 (NULL 허용 - meeting 청크는 영구히 NULL)
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS assignee_id BIGINT NULL
    REFERENCES users(id) ON DELETE SET NULL;

-- 2) 기존 task 청크의 담당자 백필
UPDATE document_chunks dc
SET assignee_id = t.assignee_id
FROM tasks t
WHERE dc.source_type = 'task' AND dc.source_id = t.id AND dc.assignee_id IS DISTINCT FROM t.assignee_id;

-- 3) 기존 action_item 청크의 담당자 백필
UPDATE document_chunks dc
SET assignee_id = ai.final_assignee_id
FROM meeting_action_items ai
WHERE dc.source_type = 'action_item' AND dc.source_id = ai.id
      AND dc.assignee_id IS DISTINCT FROM ai.final_assignee_id;

-- ---------- V20260707_2__document_chunks_vector_1024.sql ----------
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

-- ---------- V20260708_1__document_chunks_assignee_index.sql ----------
-- 개인화 RAG 검색(retrieval_service.search_similar_chunks)이
-- WHERE project_id = $2 AND assignee_id = $3 로 필터링하는데, assignee_id에 인덱스가 없어
-- document_chunks가 커지면 planner가 이 조건에 대해 순차 스캔으로 갈 수 있다.
-- meeting 청크는 assignee_id가 항상 NULL이므로 부분 인덱스로 크기를 줄인다.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)

CREATE INDEX IF NOT EXISTS idx_document_chunks_project_assignee
  ON document_chunks (project_id, assignee_id)
  WHERE assignee_id IS NOT NULL;

-- ---------- V20260709_1__rag_assignee_sync_failures.sql ----------
CREATE TABLE IF NOT EXISTS rag_assignee_sync_failures (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id BIGINT NOT NULL,
  assignee_id BIGINT,
  error_message TEXT,
  failed_at TIMESTAMP NOT NULL
);

-- ---------- V20260710_1__meetings_analysis_job_id.sql ----------
ALTER TABLE public.meetings
    ADD COLUMN IF NOT EXISTS analysis_job_id UUID;

COMMENT ON COLUMN public.meetings.analysis_job_id
    IS '현재 Redis Stream 분석 작업의 세대 식별자';

-- ---------- V20260711_1__task_completion_approval.sql ----------
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tasks.pending_approval
    IS '팀원이 완료 이동을 요청했고 아직 팀장 승인/반려 전인 상태';

-- ---------- V20260712_1__task_start_date.sql ----------
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS start_date DATE;

COMMENT ON COLUMN public.tasks.start_date
    IS '업무 시작일 (선택, 마감일보다 뒤일 수 없음)';

-- ---------- V20260713_1__task_extra_fields.sql ----------
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS extra_fields JSONB;

COMMENT ON COLUMN public.tasks.extra_fields
    IS '카테고리별 추가 정보(자유 키-값). AddTaskModal/EditTaskModal의 카테고리 전용 입력값을 저장';

