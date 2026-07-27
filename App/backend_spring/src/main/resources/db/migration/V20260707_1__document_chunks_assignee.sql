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
