# 벡터 검색이 LIMIT 5를 요청해도 2~3건만 돌려주던 문제

- 발견: 2026-08-01 (하이브리드 RAG 평가 중 부수적으로 발견)
- 조치: 2026-08-01 완료
- 대상: 운영 PostgreSQL 17, `document_chunks`
- 관련 마이그레이션: `V20260801_1__drop_document_chunks_ivfflat_index.sql`

## 증상

어시스턴트 질의응답이 근거 문서를 덜 가져오는 경우가 있었다.
`retrieval_service._SEARCH_SQL`은 `LIMIT 5`로 5건을 요청하는데, 실제로는 2~3건만
돌아왔다. 오류가 아니라 결과가 적게 오는 것이라 예외도 로그도 남지 않았다.

30개 질문으로 운영 DB를 직접 재보니 5문항이 5건을 못 채웠고, 평균 반환 건수는
4.67/5, 정확한 전량 검색 대비 상위 5건 재현율은 86.0%였다.

## 원인

`idx_document_chunks_embedding`이 다음과 같이 만들어져 있었다.

```sql
CREATE INDEX idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');
```

ivfflat은 정확 검색이 아니라 **근사 검색**이다. 벡터를 `lists`개의 후보 목록으로
미리 나눠두고, 질의할 때는 그중 `ivfflat.probes`개 목록만 훑는다. `probes`
기본값은 1이다.

문제는 규모다. `document_chunks`는 444행뿐인데 목록을 100개로 쪼개 놓았으니
목록당 약 4.4건이다. 즉 `probes=1`이면 **후보 4건 남짓만 보고 끝낸다.**
여기에 `WHERE project_id = $2` 필터까지 걸리면 남는 건 2~3건이다.
`LIMIT 5`를 적어도 애초에 후보가 5건이 안 된다.

pgvector 권장값은 `lists ≈ 행수/1000`(최소 1)이다. 444행이면 1이 적정인데
100이 들어가 있었다.

운영 카운터도 같은 이야기를 했다.

```
pg_stat_user_indexes: idx_scan=33, idx_tup_read=119   ->  스캔당 3.6건
```

## 왜 그동안 안 드러났나 (간헐성의 정체)

증상이 항상 나타나지 않아 재현이 어려웠다. 범인은 PostgreSQL의
`plan_cache_mode`다.

준비된 구문(prepared statement)은 커넥션마다 **앞 5회까지는 커스텀 플랜**을,
**6회차부터는 제네릭 플랜**을 쓴다. 커스텀 플랜은 이 인덱스를 타서 2건을
돌려주고, 제네릭 플랜은 순차 스캔을 골라 5건을 정상으로 돌려줬다.

즉 **커넥션마다 앞쪽 몇 개 질의만 나쁜 결과를 받았다.** 실측:

```
force_custom_plan    [2,2,2,2,2,2,2,2]
force_generic_plan   [5,5,5,5,5,5,5,5]
auto                 [2,2,2,2,2,5,5,5]   <- 6회차에서 갈린다
```

## 조치

현재 규모에서는 인덱스 없는 순차 스캔이 더 빠르고 정확하다. 근사 인덱스가
이득 없이 정확도만 깎고 있었으므로 제거했다.

```sql
SET lock_timeout = '3s';
DROP INDEX IF EXISTS idx_document_chunks_embedding;
```

`lock_timeout`을 건 이유: 다른 세션이 테이블 락을 잡고 있을 때 큐에 쌓여
서비스를 막는 대신 빠르게 실패하도록 하기 위해서다.

운영은 `spring.flyway.enabled=false`이므로 마이그레이션 파일은 기록용이고
적용은 수동으로 했다.

## 검증

| 지표 | 조치 전 | 조치 후 |
|---|---|---|
| top_k=5를 못 채운 질문 | 5/30 | 0/30 |
| 평균 반환 건수 | 4.67 / 5 | 5.00 / 5 |
| 정확 검색 대비 상위 5건 재현율 | 86.0% | 99.3% |
| Hit@5 | 0.667 | 0.733 |

- 실행 계획: `Seq Scan` + top-N heapsort, DB 실행 시간 3.2ms
- 플랜 종류별 반환 건수: 세 모드 모두 `[5,5,5,5,5,5,5,5]`
- 남은 인덱스 3개(`document_chunks_pkey`, `idx_document_chunks_project`,
  `idx_document_chunks_project_assignee`)는 그대로
- `/api/v1/health` 200, 컨테이너 7개 정상

재현율이 100%가 아니라 99.3%인 것은 인덱스와 무관하다. 본문이 완전히 같은
중복 청크(378건 중 109건)는 임베딩도 같아서 동점이 되고, 동점의 정렬 순서는
정해져 있지 않다. 근본 원인은 인제스트 단계의 중복이지 검색이 아니다.

## 배운 것

1. **근사 인덱스는 데이터가 적을 때 오히려 해롭다.** 정확도를 내주고 속도를
   얻는 거래인데, 444행에서는 내줄 정확도만 있고 얻을 속도가 없다.
2. **결과가 "적게" 오는 실패는 조용하다.** 예외가 없으니 로그에도 안 남고
   알림도 안 뜬다. `LIMIT n`을 요청했는데 n건이 안 오는 상황을 의심 목록에
   넣어둘 것.
3. **간헐적 증상이면 플랜 캐시를 의심할 것.** `plan_cache_mode`를
   `force_custom_plan` / `force_generic_plan`으로 고정해서 비교하면 바로 갈린다.

## 재도입 기준

`document_chunks`가 1만 건을 넘어 순차 스캔 지연이 체감되면, ivfflat이 아니라
**HNSW**를 쓴다. HNSW는 `probes` 같은 절벽이 없어 이런 식으로 조용히 망가지지
않는다.

```sql
CREATE INDEX idx_document_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);
```
