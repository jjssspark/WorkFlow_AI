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

### 조치 — 장부에 4행 등록 (2026-07-29 실행 완료)

`flyway repair`로는 해결되지 않는다. repair는 체크섬 재정렬과 실패행 정리만 하고,
실행된 적 없는 마이그레이션을 "적용됨"으로 만들지 않는다. 수동 INSERT가 필요하다.

실행 전 `pg_stat_activity`에서 활성 세션 0건, `flyway_schema_history` 락 0건을 확인했다.
실행 후 장부는 baseline 1행 + SQL 28행이며, 체크섬 불일치 0건이다.

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

`EvalStatus.java`와 프론트 타입에 남아 있던 `DONE`은 **enum에서 제거하는 쪽으로 정리했다.**

- 저장하는 코드 경로가 없었다. `setEvalStatus()` 호출부 2곳은 `PUBLISHED`/`EVALUATING`만 쓴다.
- 의미가 정의된 적이 없다. 라벨은 `DONE = "평가 완료"`, `PUBLISHED = "공개 완료"`인데 실제
  흐름은 `EVALUATING → (평가 확정) → PUBLISHED`로 직행한다. 중간 단계가 제품에 없다.
- `MyPage.tsx`의 "평가 완료" 지표가 값을 만들 경로 없이 **영원히 0**을 표시하고 있었다.

제거 범위: `EvalStatus.java`, `global/lib/evalStatus.ts`, `mypage/screen/MyPage.tsx`,
`mypage/libs/utils/reviewerApi.ts`. DB는 이미 3값이라 건드리지 않았다.
enum 값이 다시 늘어날 때 CHECK도 함께 넓히도록 `EvalStatusTest`에 값 목록 검증을 추가했다.

## 발견 3 — legacy divergence 30건

2026-07-26에 기록된 30건이 그대로 남아 있었다.

- `workload_scores` 테이블 + 컬럼 6개, `uq_action_items_created_task`, 성능 인덱스 6개 —
  운영에만 존재하고 `docs/db/workflow_ai_schema.sql` 스냅샷에만 정의됨 (`workload_scores`는 0행)
- FK 이름 5개 불일치 (`fk_chunks_assignee` ↔ `document_chunks_assignee_id_fkey` 등)
- FK 4개가 운영에서 `ON DELETE` 절 누락 (`fk_notifications_user`에 CASCADE 없음 등)
- `varchar` 10개가 운영에서 길이 제한 없음 (`notifications.title`, `meetings.meeting_type` 등)
- `meeting_action_items.id`/`notifications.id`가 운영은 IDENTITY, 레포는 serial

### 조치 — `V20260729_4__align_legacy_divergence_with_production.sql`

결정 문서는 이 정리를 OCI 이관 시점으로 미뤄뒀으나, 대조 시점에 운영 기준으로 전부 맞췄다.
빈 DB만 바뀌고 운영에서는 no-op이다.

**한 가지 주의**: FK 4건의 `ON DELETE` 절 제거는 빈 DB를 운영과 "같게" 만들지만 "더 낫게"
만들지는 않는다. 운영에서 부모 행 삭제가 `RESTRICT`(기본값)로 막히는 동작을 새 환경에도
그대로 옮기는 것이다. 어느 쪽이 옳은지는 별도 판단이 필요하다.

### 검증

`pgvector:pg17` 컨테이너에 `db/init` + V파일 30개를 적용한 레퍼런스 DB와 운영을 비교했다.

| | 운영 | 레퍼런스 | 차이 |
|---|---|---|---|
| 테이블 | 30 | 30 | 0 |
| 컬럼 | 258 | 258 | 0 |
| 제약 | 92 | 92 | 0 |
| 인덱스 | 58 | 58 | 0 |

레퍼런스 DB(=운영과 동일 상태)에 `V20260729_3`·`V20260729_4`를 **재적용**한 뒤에도 차이 0이다.

**비교 대상에 포함되지 않은 것**: 테이블·컬럼 COMMENT, 권한(GRANT), RLS 정책, `public` 외 스키마.

## 실행 영향 — "no-op"의 정확한 의미

최초 커밋 메시지에 "운영에서는 전부 no-op"이라고 썼는데 **부정확하다.** 결과가 같다는 뜻이지
아무것도 실행하지 않는다는 뜻이 아니다. 정확히는 이렇다.

### `V20260729_3` — 운영에서도 실제 DDL이 실행된다

| 문장 | 운영에서 | 비용 |
|---|---|---|
| `ALTER COLUMN eval_status SET DEFAULT` | 실행됨 (이미 같은 값) | 카탈로그만, 스캔 없음 |
| `DROP CONSTRAINT` + `ADD CONSTRAINT ... CHECK` | **실행됨** | `ADD`가 전체 행 검증 스캔. `projects` 30행 |
| `ALTER COLUMN position DROP DEFAULT` | 실행됨 (이미 없음) | 카탈로그만 |
| `ADD COLUMN IF NOT EXISTS move_version` | 건너뜀 | — |

모두 `ACCESS EXCLUSIVE` 락을 잡는다. 지금 `projects`가 30행이라 실측상 문제가 되지 않지만,
"실행되지 않는다"는 설명은 틀렸다. 테이블이 커지면 락 구간도 커진다.

### `V20260729_4` — 운영에서는 사실상 실행되는 것이 없다

파괴적으로 보이는 DDL(FK 재생성, 시퀀스 삭제·IDENTITY 전환, varchar 타입 변경)은 전부
현재 상태를 먼저 확인하는 가드 안에 있고, 운영은 이미 목표 상태라 모두 건너뛴다.
실제로 실행되는 것은 `COMMENT` 2건과 7절 검증 쿼리뿐이다.

## 빈 DB가 아닌 환경 — 실제로 실패했다

빈 DB와 운영만 검증한 것은 부족했다. **정합화 전에 만들어져 데이터가 쌓인 로컬·스테이징 DB**를
재현해 돌려보니 `V20260729_4`가 실패했다.

```
ERROR:  could not create unique index "uq_action_items_created_task"
DETAIL:  Key (created_task_id)=(1) is duplicated.
```

운영에는 이 제약이 이미 있어 위반 행이 존재할 수 없지만, 제약이 없던 환경에서는 액션 아이템
둘이 같은 업무를 가리키는 상태가 만들어질 수 있다. Flyway는 마이그레이션을 트랜잭션으로 감싸
전체가 롤백되지만, **실패 자체가 배포를 막는다.**

### 조치 — 자동 수정이 아니라 중단

처음에는 가장 오래된 연결만 남기고 나머지를 `NULL`로 자동 해제하게 고쳤다. **되돌렸다.**
어느 연결이 진짜인지는 이 파일이 알 수 없고, 스키마 마이그레이션이 조용히 데이터를 바꾸면
안 된다. `RAISE NOTICE`는 아무도 읽지 않는 로그로 흘러간다.

지금은 **대상 행과 해소 방법을 알려주고 멈춘다.**

```
ERROR:  uq_action_items_created_task를 걸 수 없다. 한 업무를 여러 액션 아이템이 가리킨다:
        created_task_id=1 (action_item id: 1,2)  --  어느 연결이 맞는지 확인한 뒤 나머지를
        해제하고 다시 실행할 것. 예) UPDATE meeting_action_items SET created_task_id = NULL WHERE id IN (...);
```

운영에서는 대상이 0건이라 발생하지 않는다. 걸리는 곳은 로컬·스테이징뿐이고, 거기서는
배포가 멈추는 편이 데이터가 말없이 바뀌는 것보다 낫다.

### 조치 — 제약 조회를 테이블·스키마까지 한정

PostgreSQL의 제약 이름은 **테이블 단위로만 유일**하다. `WHERE conname = '...'`만 쓰면 다른
테이블이나 다른 스키마(Supabase의 `auth`·`storage`)의 동명 제약에 걸린다. `NOT EXISTS`
가드에서 이게 걸리면 **정합화를 통째로 건너뛰고도 성공으로 끝난다.**

모든 조회에 `conrelid = 'public.<table>'::regclass`를 붙였다.

### 조치 — 검증을 "존재"에서 "정의 완전 일치"로 (`V20260729_5`)

검증을 두 번 고쳤다.

**1차(`_4`의 7절)** — 객체 존재만 보던 것을 속성 일부까지 넓혔다. 여전히 부족했다.
이름이 맞아도 **FK의 대상·참조 컬럼, UNIQUE 구성, 인덱스 컬럼 순서**가 다르면 통과했고,
`eval_status` 기본값은 `LIKE '%EVALUATING%'`이라 `'NOT_EVALUATING'`도 통과했다.
"정의를 대조한다"는 설명이 실제보다 앞서 있었다.

**2차(`V20260729_5`)** — 운영에서 그대로 뽑은 정의 문자열과 **완전 일치**를 요구한다.

| 대상 | 비교 방식 |
|---|---|
| 제약 14건 | `pg_get_constraintdef()` 전문 — 대상 컬럼·참조 대상·`ON DELETE`·CHECK 식 포함 |
| 인덱스 6건 | `pg_indexes.indexdef` 전문 — 컬럼 구성·순서·UNIQUE 여부 포함 |
| 컬럼 11건 | 타입·NULL 허용·IDENTITY·기본값 완전 일치 |
| varchar 10건 | 길이 제한 부재 |

어긋나면 **기대값과 실제값을 나란히** 출력하고 멈춘다.

`_4`를 고치지 않고 새 파일로 만든 이유: `_4`는 이미 dev에 있어 팀원 로컬에서 실행됐을 수
있다. 적용된 V파일을 고치면 Flyway 체크섬 검증이 깨진다(2026-07-26 운영 41분 중단).
`migration-guard` CI도 신규 추가(`A`)만 허용한다.

기준값은 2026-07-29 운영(PG 17.6)에서 조회한 값이다. **PostgreSQL 메이저 버전이 바뀌어
출력 포맷이 달라지면 이 파일이 먼저 깨진다.** 그때는 기준값을 다시 뽑아 또 새 V파일로
교체한다.

#### 이 검증기가 실제로 잡는지 확인한 것

정합화된 DB를 일부러 어긋나게 만들어 전부 검출을 확인했다.

| 주입한 어긋남 | 검출 |
|---|---|
| FK 이름은 같고 참조 컬럼이 다름 | ✓ |
| UNIQUE 구성이 다름 (`(a)` → `(a,b)`) | ✓ |
| 인덱스 컬럼 순서가 다름 | ✓ |
| `eval_status` 기본값 `'NOT_EVALUATING'` (1차 검증은 통과시켰을 값) | ✓ |

작성 중 기준값 오타(`workload_scores.id`의 `BIGSERIAL` 기본값 누락)도 이 검증기가 잡았다.

### 재검증

| 출발 상태 | 결과 |
|---|---|
| 빈 DB (init + V파일 30개) | 운영과 차이 **0** |
| 데이터 있는 중간 환경 (중복 `created_task_id` 포함) | 대상 행을 지목하며 **중단**, 데이터 무변경 |
| 위 환경을 안내대로 해소 후 재실행 | 운영과 차이 **0** |
| FK 동명 decoy를 다른 테이블에 심은 환경 | 진짜 FK만 정확히 정합화 (decoy 무영향) |
| UNIQUE 동명 decoy | 조용히 건너뛰지 않고 **중단** (인덱스 이름은 스키마 단위로 유일) |
| 정합화된 DB에 `_3`·`_4` 재적용 | 차이 **0** |
| 백엔드 테스트 691건 | 전부 통과 |

IDENTITY 전환도 데이터가 있는 상태에서 확인했다. `notifications` 최대 id가 2인 DB를 전환한 뒤
새 INSERT가 3을 받는다.

**이 검증이 보장하지 않는 것**: 위 표는 *내가 만든* 출발 상태들에 대한 결과다. 손으로 고친
컬럼 타입, 지워진 인덱스, 다르게 갈라진 스키마를 가진 임의의 로컬 DB까지 "차이 0"을
보장하지는 않는다. 그런 환경에서는 7절 검증이 어긋난 항목을 나열하며 멈춘다 — 조용히
통과하는 것보다 낫지만, 자동으로 고쳐주지는 않는다.

## 이 변경이 바꾸는 동작 (빈 DB·중간 환경 한정, 운영은 이미 그 상태)

정합화는 스키마를 같게 만들지만, 그 과정에서 **운영이 아닌 환경의 동작이 바뀐다.**

| 변경 | 바뀌는 동작 | 현재 노출 |
|---|---|---|
| `chk_projects_eval_status`에서 `DONE` 제거 | `EvalStatus.DONE` 저장 시 CHECK 위반 | **해소** — enum·프론트 타입에서 `DONE` 제거 |
| FK 4건 `ON DELETE` 제거 | 부모 행 삭제가 `RESTRICT`로 막힘 | 사용자 삭제 기능 없음. 회의 삭제는 앱이 자식 행을 먼저 정리 |
| `uq_action_items_created_task` 추가 | 액션 아이템이 업무 하나만 만들 수 있음 | 중복 행은 마이그레이션이 해제 |
| `serial` → `IDENTITY` | 없음 (JPA `GenerationType.IDENTITY`는 양쪽 동작) | — |

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
