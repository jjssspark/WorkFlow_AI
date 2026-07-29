# 운영 Supabase와 레포 SQL의 스키마 대조 — 장부 결번 4건과 정의 불일치 4건

- 날짜: 2026-07-29
- 발견 경로: `supabase db dump`로 운영 스키마를 받아 레포 SQL과 전수 대조 (운영 장애는 발생하지 않음)
- 대상: Supabase project `zzfcnbbzmbxzxptxghhq` (PostgreSQL 17.6.1.141)
- 관련: [스키마 변경 경로 일원화 결정](../decisions/2026-07-26-flyway-single-migration-path.md),
  [Flyway 버전 중복과 preflight 오탐](2026-07-27-flyway-duplicate-version-and-pending-preflight.md)

## 왜 확인했나

스키마 변경 경로를 Flyway 하나로 일원화한 뒤(2026-07-26), 그 규율이 실제로 지켜지고 있는지
운영 DB와 레포를 직접 대조한 적이 없었다. 결정 문서는 당시 남은 divergence 30건을 기록했지만
그 이후에 새로 벌어진 차이는 아무도 보지 않았다.

## 어떻게 확인했나

"코드가 말하는 스키마"를 실물로 재현해서 운영과 객체 단위로 비교하는 방식이다.

1. `supabase db dump --linked -s public` — 운영 스키마 스냅샷
2. 운영 `flyway_schema_history` 조회 + 로컬 V파일의 Flyway 체크섬(CRC32 줄 단위 누적)을
   직접 계산해 대조. 기존 25행이 25/25 일치해 계산기 자체가 맞다는 근거를 먼저 확보했다.
3. `pgvector/pgvector:pg17` 컨테이너에 `db/init/*`를 initdb로 태우고,
   baseline(20260721.1) 이후 V파일 28개를 버전 순서대로 적용 → **레퍼런스 DB**
4. 레퍼런스 DB와 운영의 테이블·컬럼·제약·인덱스를 `information_schema`/`pg_catalog`로 뽑아 diff

재현 스크립트는 이 문서 하단 "재현 절차"에 있다.

## 발견 1 — 장부 결번 4건 (배포 차단 위험)

`flyway_schema_history`는 **20260728.4(rank 25)**에서 멈춰 있는데, 그 뒤 V파일 4개의
**객체는 이미 운영 DB에 존재한다.**

| V파일 | 운영 DB 객체 | 장부 |
|---|---|---|
| `V20260728_5__comments_parent_id` | `comments.parent_id`, `ux_comments_one_reply_per_parent` 존재 | 없음 |
| `V20260728_6__invitation_link_email_optional` | `invitations.email` nullable 적용됨 | 없음 |
| `V20260729_1__project_members_last_accessed_at` | `project_members.last_accessed_at` 존재 | 없음 |
| `V20260729_2__projects_year` | `projects.year` 존재 | 없음 |

누군가 Flyway를 거치지 않고 수동으로 DDL을 실행했다. 2026-07-26 결정 문서가 막으려던 바로 그
경로이며, 3층 방어 중 2층(DB 롤 분리)이 OCI 이관 시점으로 미뤄져 있어 열려 있던 틈이다.

**영향**: 다음 배포에서 `SPRING_FLYWAY_ENABLED=true`로 기동하면 Flyway가 이 4개를 미적용으로
보고 실행한다. `ALTER TABLE comments ADD COLUMN parent_id`가 `column already exists`로 실패해
2026-07-26과 같은 크래시루프에 빠진다.

체크섬 불일치는 없었다. 적용된 V파일을 나중에 고친 흔적은 없다.

### 조치 — 장부에 4행 등록

`flyway repair`로는 해결되지 않는다. repair는 체크섬 재정렬과 실패행 정리만 하고,
실행된 적 없는 마이그레이션을 "적용됨"으로 만들지 않는다. 수동 INSERT가 필요하다.

```sql
BEGIN;
-- 안전장치: 장부 끝이 rank 25 / 20260728.4가 아니면 중단
DO $$
BEGIN
  IF (SELECT max(installed_rank) FROM flyway_schema_history) <> 25
     OR (SELECT version FROM flyway_schema_history WHERE installed_rank = 25) <> '20260728.4' THEN
    RAISE EXCEPTION '장부 상태가 예상과 다르다. 중단한다.';
  END IF;
END $$;

INSERT INTO flyway_schema_history
  (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success)
VALUES
  (26, '20260728.5', 'comments parent id',               'SQL', 'V20260728_5__comments_parent_id.sql',              -1824602986, 'postgres', now(), 0, true),
  (27, '20260728.6', 'invitation link email optional',   'SQL', 'V20260728_6__invitation_link_email_optional.sql',    -647001811, 'postgres', now(), 0, true),
  (28, '20260729.1', 'project members last accessed at', 'SQL', 'V20260729_1__project_members_last_accessed_at.sql',   860603182, 'postgres', now(), 0, true),
  (29, '20260729.2', 'projects year',                    'SQL', 'V20260729_2__projects_year.sql',                     1466002807, 'postgres', now(), 0, true);
COMMIT;
```

- **전제**: 실행 시점에 `SPRING_FLYWAY_ENABLED=true`로 이 DB에 붙어 있는 backend-spring이
  없어야 한다. 2026-07-26 복구 때 이 순서를 안 지켜 크래시루프 중이던 옛 컨테이너가
  자기 기준으로 baseline을 찍은 사고가 있었다.
- **되돌리기**: `DELETE FROM flyway_schema_history WHERE installed_rank BETWEEN 26 AND 29;`

### 왜 baseline 재설정이 아니라 4행 등록인가

| | 4행 등록 | baseline 재설정 |
|---|---|---|
| 장부 결과 | rank 1~29, 이력 연속 | rank 1행(BASELINE 20260729.2), 이력 25건 소멸 |
| 실수 지점 | 체크섬 계산 | 컨테이너 정지 순서, `application.yml` 기본값, 7명 `.env` 동기화 |
| 되돌리기 | 4행 DELETE | 백업 테이블에서 복원 |
| 부작용 | 없음 | baseline 아래 V파일이 빈 DB에서 영영 실행되지 않아 divergence 확대 |

이번 문제는 "장부 전체가 오염됐다"가 아니라 "4행이 빠졌다"라서, 25건을 버리는 대가에 비해
baseline 재설정으로 얻는 게 없다. baseline 재설계는 결정 문서대로 OCI 이관 시점에 한다.

## 발견 2 — 정의 불일치 4건

운영과 레퍼런스 DB의 정의가 실제로 다르고, 사고로 이어질 수 있는 항목이다.

| 대상 | 운영 | 레포 V파일 재현 | 성격 |
|---|---|---|---|
| `projects.eval_status` DEFAULT | `'EVALUATING'` | `'PENDING'` | JPA가 값을 명시하므로 앱 영향 없음 |
| `chk_projects_eval_status` | PENDING/EVALUATING/PUBLISHED | + **DONE** | 실제 무결성 차이 |
| `tasks.position` DEFAULT | 없음 | `0` | primitive double이라 앱 영향 없음 |
| `tasks.move_version` | `bigint NOT NULL DEFAULT 0` 존재 | **레포 어디에도 정의 없음** | 출처 불명 |

CHECK 제약이 갈린 이유는 `V20260723_2`/`V20260724_6`이 `IF NOT EXISTS` 가드로 감싸여 있어서다.
운영에는 이미 3값짜리 제약이 있었으므로 가드가 갱신을 건너뛰었고, 빈 DB에서만 4값이 만들어졌다.
**idempotency 가드는 "없으면 만든다"만 보장하지 "있으면 최신으로 맞춘다"를 보장하지 않는다.**

`tasks.move_version`은 `TaskController.java:267`의 지역변수 `moveVersion`(WebSocket 페이로드용
타임스탬프)과 이름만 같고 무관하다. 정의된 곳이 없다.

### 조치 — `V20260729_3__align_schema_with_production.sql`

운영을 기준으로 삼아 빈 DB 쪽을 맞춘다. 이미 적용된 V파일은 `migration-guard` CI가 수정을
막으므로 신규 V파일로 처리했다. 운영에서는 4건 전부 no-op이다.

`EvalStatus.java`에는 `DONE`이, 프론트 `MyPage.tsx` 타입에도 `"done"`이 남아 있다. 저장하는
코드 경로가 없어 사고가 나지 않았을 뿐이며, **enum에서 빼거나 CHECK에 넣거나 한쪽으로
정리해야 한다.** 프론트 계약을 건드려야 해서 이번 범위에서는 제외했다.

## 발견 3 — 결정 문서가 이미 아는 legacy divergence (현재도 유효)

2026-07-26에 기록된 30건이 그대로 남아 있다. 이번 대조로 재확인만 했다.

- `workload_scores` 테이블 + 컬럼 6개, `uq_action_items_created_task`, 성능 인덱스 6개 —
  운영에만 존재하고 `docs/db/workflow_ai_schema.sql` 스냅샷에만 정의됨 (`workload_scores`는 0행)
- FK 이름 5개 불일치 (`fk_chunks_assignee` ↔ `document_chunks_assignee_id_fkey` 등)
- FK 4개가 운영에서 `ON DELETE` 절 누락 (`fk_notifications_user`에 CASCADE 없음 등)
- `varchar` 10개가 운영에서 길이 제한 없음 (`notifications.title`, `meetings.meeting_type` 등)
- `meeting_action_items.id`/`notifications.id`가 운영은 IDENTITY, 레포는 serial (기능 동등)

정리 시점은 결정 문서대로 **OCI 자체호스팅 Postgres 이관 시 baseline 재설계와 함께**다.

## 재현 절차

```bash
# 1. 운영 스키마 스냅샷
supabase db dump --linked -p "$SPRING_DATASOURCE_PASSWORD" -s public -f /tmp/remote_public.sql

# 2. 레퍼런스 DB (빈 DB + init + baseline 이후 V파일)
docker run -d --name wf-schema-check -e POSTGRES_PASSWORD=root -p 55432:5432 \
  -v "$PWD/App/backend_spring/src/main/resources/db/init:/docker-entrypoint-initdb.d:ro" \
  pgvector/pgvector:pg17

# baseline(20260721.1)보다 큰 V파일을 버전 순서대로 적용
for f in $(ls App/backend_spring/src/main/resources/db/migration/V*.sql | sort -V); do
  docker exec -i wf-schema-check psql -U postgres -v ON_ERROR_STOP=1 -q < "$f"
done

# 3. 두 DB의 information_schema.columns / pg_constraint / pg_indexes를 뽑아 diff
```

Flyway 체크섬은 파일을 줄 단위로 읽어 CRC32를 누적한 값이다(줄바꿈 문자는 제외).
장부의 기존 행과 대조해 계산기가 맞는지 먼저 검증한 뒤 새 값을 만들 것.

## 배운 것

- **idempotency 가드는 정합성을 보장하지 않는다.** `IF NOT EXISTS`로 감싼 제약·컬럼은
  기존 DB에서 영원히 옛 정의로 남는다. 정의를 바꿀 때는 가드가 아니라 DROP + ADD가 필요하다.
- **장부와 스키마는 따로 어긋난다.** 체크섬 검증(2026-07-26 장애)은 "적용된 것이 바뀐" 경우를
  잡지만, "적용되지 않은 것이 이미 존재하는" 경우는 배포를 시도해야 드러난다.
  `flyway validate`를 preflight에 넣어둔 것이 이번에도 유일한 방어선이었다.
- **공유 운영 DB에 대한 수동 DDL은 계속 벌어진다.** 3층 방어 중 2층(DB 롤 분리)이 비어 있는
  한 규율만으로는 막히지 않는다. OCI 이관 때 반드시 닫아야 한다.
