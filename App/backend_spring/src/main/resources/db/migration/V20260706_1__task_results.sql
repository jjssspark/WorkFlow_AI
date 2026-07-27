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
