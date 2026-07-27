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
