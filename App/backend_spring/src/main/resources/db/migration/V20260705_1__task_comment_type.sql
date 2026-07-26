-- 업무 코멘트를 "일반 코멘트"와 "팀장 피드백"으로 구분하기 위한 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)

ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'COMMENT';
-- type: 'COMMENT' | 'FEEDBACK'
