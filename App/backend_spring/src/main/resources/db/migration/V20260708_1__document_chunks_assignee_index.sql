-- 개인화 RAG 검색(retrieval_service.search_similar_chunks)이
-- WHERE project_id = $2 AND assignee_id = $3 로 필터링하는데, assignee_id에 인덱스가 없어
-- document_chunks가 커지면 planner가 이 조건에 대해 순차 스캔으로 갈 수 있다.
-- meeting 청크는 assignee_id가 항상 NULL이므로 부분 인덱스로 크기를 줄인다.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)

CREATE INDEX IF NOT EXISTS idx_document_chunks_project_assignee
  ON document_chunks (project_id, assignee_id)
  WHERE assignee_id IS NOT NULL;
