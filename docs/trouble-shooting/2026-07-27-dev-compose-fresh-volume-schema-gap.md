# 개발용 compose를 빈 볼륨으로 올리면 스키마가 두 군데서 어긋난다

- 날짜: 2026-07-27
- 발견 경로: IT-039(회의 분석~RAG 자동 색인~질의) 실물 스택 검증 중
- 운영 장애 없음. 공유 Supabase를 쓰는 현재는 아무도 밟지 않는다
- 관련: [스키마 변경 경로 일원화 결정](../decisions/2026-07-26-flyway-single-migration-path.md),
  [DEPLOY_OCI.md 8절 빈 DB 구축 시 차이](../../App/DEPLOY_OCI.md)

## 증상

`App/docker-compose.yml`의 `db` 서비스를 **빈 볼륨**으로 처음 올리면 두 단계에서 막힌다.

```
1) db/init/11_pre_baseline_backfill.sql
   ERROR: extension "vector" is not available
   → 순정 postgres:17에는 pgvector가 없다

2) (pgvector 이미지로 바꾼 뒤) 회의록 저장
   ERROR: column "edited_by" of relation "meetings" does not exist
   → baseline 위 마이그레이션이 하나도 적용되지 않았다
```

두 번째는 회의록만의 문제가 아니다. baseline(`20260721.1`) 위 V파일이 **20개**이고,
회의록 버전 관리·평가 점수·로드맵 일정·관리자 승인·업무 완료일·사용자 프로필이 전부 여기 있다.

## 왜 지금까지 아무도 몰랐나

개발자 7명이 로컬에서 **운영 Supabase를 공유**한다. compose의 `db` 서비스는 실질적으로
쓰이지 않는다. 기존 볼륨을 계속 쓰는 사람도 초기화 스크립트를 다시 밟지 않는다.

즉 이 경로를 밟는 사람은 **오늘 처음 합류해서 빈 볼륨으로 올리는 사람**뿐이다.

## 원인

### 1. 이미지에 pgvector가 없다 — 단순 실수

| 파일 | 이미지 |
|---|---|
| `docker-compose.prod.yml:13` | `pgvector/pgvector:pg17` (정상) |
| `docker-compose.yml:9` | `postgres:17` |

`db/init/11_pre_baseline_backfill.sql`이 `CREATE EXTENSION vector`를 실행하므로 순정
이미지로는 초기화가 그 지점에서 끊긴다. 개발용만 어긋나 있었다.

### 2. Flyway가 꺼져 있다 — 이건 의도된 설계다

```yaml
# docker-compose.yml
SPRING_FLYWAY_ENABLED: ${SPRING_FLYWAY_ENABLED:-false}
```

**이 값을 되돌리면 안 된다.** 2026-07-26, 한 개발자가 push하지 않은 로컬 브랜치로 공유
Supabase에 Flyway를 실행해 운영 API가 41분 중단됐다. 그 대응으로 기본값을 `false`로
뒤집고 "켜는 쪽을 명시적으로" 만든 것이 이 설정이다(결정 문서 2층 방어의 1층).

따라서 이건 고칠 대상이 아니라 **알고 있어야 할 전제**다. `db/init`은 결정 문서가 정한 대로
"빈 DB 최초 부트스트랩 전용"이고, 그것만으로 최신 스키마가 되지는 않는다.

## 조치

**이미지만 고쳤다.** `docker-compose.yml`의 `postgres:17` → `pgvector/pgvector:pg17`.
같은 Postgres 17이라 기존 볼륨에는 영향이 없다.

Flyway 기본값은 그대로 둔다. 빈 볼륨으로 새 환경을 만드는 사람은 다음 중 하나를 택한다.

```bash
# A. 그 환경에서만 Flyway를 명시적으로 켠다 (로컬 전용 DB일 때만)
SPRING_FLYWAY_ENABLED=true docker compose up

# B. baseline 위 V파일을 직접 적용한다 (공유 DB를 볼 위험이 있을 때)
#    버전 정렬은 사전순이 아니라 숫자순이다 - 20260724.2 < 20260724.10
```

> **주의:** A를 고를 때는 `SPRING_DATASOURCE_URL`이 로컬 DB를 가리키는지 반드시 먼저
> 확인한다. 공유 Supabase를 보는 상태에서 켜면 2026-07-26 장애가 그대로 재현된다.

## OCI 자체호스팅 Postgres 이관 시 유의점

이 문제 자체는 개발용 compose 한정이지만, **빈 DB를 만든다**는 점에서 이관과 같은 상황이다.
이관 방식에 따라 갈린다.

| 방식 | divergence |
|---|---|
| Supabase 덤프 → OCI 복원 | 없음. `flyway_schema_history`째로 넘어가 이후 마이그레이션도 이어진다. **pgvector 확장 사전 설치만 확인** |
| `db/init` + Flyway로 재구축 | `DEPLOY_OCI.md` 8절 표의 차이가 남는다 |

재구축을 택할 경우 실제 영향이 있는 것은 둘이다.

- `uq_action_items_created_task` 유니크 제약 부재 — 무결성 차이라 중복이 조용히 쌓인다
- 재임베딩 1회 필요 — `V20260707_2`가 기존 벡터를 NULL로 비운다 (`DEPLOY_OCI.md` 참조)

`workload_scores` 테이블 부재는 FastAPI가 정상 처리한다(`contribution_db.py`).
성능 인덱스 6개는 대용량에서만 차이난다.

이 divergence 정리는 결정 문서가 **"OCI 이관 시점의 baseline 재설계와 함께 결정한다"** 고
미뤄둔 항목이다. 이관이 그 처리 시점이다.

---

## 부록 · IT-039 실물 스택 재현 절차

위 증상을 밟은 환경이자, `MeetingIndexingLiveStackIntegrationTest`를 돌리는 방법이다.
그 테스트는 `IT039_LIVE_STACK=true`가 없으면 건너뛴다(CI 스위트에도 등록하지 않았다).

이 구성의 의미: 색인 줄기를 조각내어 검증한 다른 테스트들과 달리 **대역이 하나도 없다.**
실제 bge-m3 임베딩, 실제 pgvector 코사인 검색, 실제 LLM 답변 생성까지 운영과 같다.

### 1. DB·Redis

```bash
cd App
docker run -d --name it039-pg \
  -e POSTGRES_DB=workflow -e POSTGRES_USER=workflow -e POSTGRES_PASSWORD=workflow \
  -p 55432:5432 \
  -v "$PWD/backend_spring/src/main/resources/db/init:/docker-entrypoint-initdb.d:ro" \
  pgvector/pgvector:pg17
docker run -d --name it039-redis -p 56379:6379 redis:7-alpine
```

### 2. baseline 위 마이그레이션 적용

`db/init`만으로는 위 증상 2를 밟는다. 버전 숫자순으로 정렬해서 적용한다.

```bash
cd backend_spring/src/main/resources/db/migration
python3 -c "
import os, re
key = lambda f: tuple(int(x) for x in re.match(r'V(\d+)_(\d+)__', f).groups())
files = [f for f in os.listdir('.') if f.startswith('V')]
print('\n'.join(sorted([f for f in files if key(f) > (20260721, 1)], key=key)))
" | while read f; do docker exec -i it039-pg psql -U workflow -d workflow -v ON_ERROR_STOP=1 -q < "$f"; done
```

### 3. FastAPI

임베딩 모델(`rhantj/bge-m3-workflow-query-robust`, 2.1GB)이 HF 캐시에 있어야 한다.
없으면 첫 기동에서 내려받는다. 기동 자체는 모델 로드 실패해도 되지만(lifespan이 예외를
삼킨다) 색인 시점에 필요하다.

```bash
cd App/backend_fastapi
DATABASE_URL="postgresql://workflow:workflow@127.0.0.1:55432/workflow" \
REDIS_URL="redis://127.0.0.1:56379/0" \
RAG_INTERNAL_API_KEY="it039-internal-key" \
HF_TOKEN="$(grep -m1 '^HF_TOKEN=' ../.env | cut -d= -f2-)" \
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 58000
```

`Application startup complete.`가 뜰 때까지 기다린다(모델 캐시가 있을 때 약 14초).

### 4. 실행

```bash
cd App/backend_spring
IT039_LIVE_STACK=true ./gradlew test \
  --tests "com.workflowai.meeting.MeetingIndexingLiveStackIntegrationTest"
```

기본 접속 정보는 위 포트에 맞춰져 있다. 다르면 `IT039_DB_URL`, `IT039_FASTAPI_URL`,
`IT039_INTERNAL_KEY` 등으로 덮는다(테스트 클래스 javadoc 참조).

### 5. 정리

```bash
docker rm -f it039-pg it039-redis
```

### 2026-07-27 실측 결과

| 항목 | 값 |
|---|---|
| 테스트 | 1건 통과, 22.0초 |
| FastAPI 기동 | 14초 (모델 캐시 있음) |
| 색인 | `POST /ai/rag/ingest 200`, 1청크, `vector_dims = 1024` |
| 저장 내용 | `buildMeetingIngestContent` 산출물 (요약 + "결정사항:") |
| 질의 | `POST /ai/rag/query 200`, 해당 회의가 출처로 반환 |
| 유사도 | 0.738 — 합성 벡터의 1.0이 아닌 실제 모델 값 |

수동 색인 요청 없이 **회의 분석 저장만으로** 색인됐다는 것이 IT-039의 검증 대상이고,
DB 행과 uvicorn 액세스 로그 양쪽에서 교차 확인했다.
