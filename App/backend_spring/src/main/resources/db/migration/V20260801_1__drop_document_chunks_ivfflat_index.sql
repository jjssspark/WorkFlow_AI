-- document_chunks의 ivfflat 인덱스를 제거한다.
--
-- 문제:
--   CREATE INDEX idx_document_chunks_embedding
--     ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists='100')
--
--   ivfflat은 벡터를 lists개 후보 목록으로 나눠두고, 질의 시 ivfflat.probes개 목록만
--   훑는 근사 검색이다. probes 기본값은 1이다.
--   그런데 document_chunks는 전체 444행뿐이라 목록당 약 4.4건이다.
--   즉 probes=1이면 후보 4건만 보고 끝내고, 거기에 WHERE project_id 필터까지 걸리면
--   retrieval_service._SEARCH_SQL이 LIMIT 5를 요청해도 2~3건만 돌아온다.
--   pg_stat_user_indexes 실측: idx_scan=33, idx_tup_read=119 -> 스캔당 3.6건.
--
--   pgvector 권장값은 lists ~= 행수/1000 (최소 1)이다. 444행이면 1이 적정인데 100이 들어가 있었다.
--
--   증상이 간헐적이라 그동안 드러나지 않았다. 준비된 구문이 커스텀 플랜일 때만
--   이 인덱스를 타기 때문이다(커넥션당 앞 5회). 6회차부터는 제네릭 플랜이 순차 스캔을
--   선택해 정상 동작한다. 즉 커넥션마다 앞쪽 몇 개 질의만 나쁜 결과를 받았다.
--
-- 조치:
--   현재 규모에서는 인덱스 없는 순차 스캔이 2ms이고 결과가 정확하다.
--   근사 인덱스가 이득 없이 정확도만 깎고 있으므로 제거한다.
--
-- 재도입 기준:
--   document_chunks가 1만 건을 넘어 순차 스캔 지연이 체감되면 ivfflat이 아니라 HNSW를 쓴다.
--   HNSW는 probes 같은 절벽이 없어 이런 방식으로 조용히 망가지지 않는다.
--     CREATE INDEX idx_document_chunks_embedding
--       ON document_chunks USING hnsw (embedding vector_cosine_ops);
--
-- 되돌리기 (원상 복구):
--   CREATE INDEX idx_document_chunks_embedding
--     ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');
--   단, 되돌리면 위 문제도 같이 돌아온다. 되돌릴 이유가 있다면 lists=1로 만드는 편이 낫다.
--
-- 적용: OCI 운영 PostgreSQL 17 (spring.flyway.enabled=false 이므로 수동 적용)

-- 다른 세션이 테이블 락을 잡고 있으면 큐에 쌓여 서비스를 막지 않도록 빠르게 실패시킨다.
SET lock_timeout = '3s';

DROP INDEX IF EXISTS idx_document_chunks_embedding;
