# 스키마 변경 경로를 Flyway 하나로 일원화하고, 운영 DB 쓰기 주체를 배포 파이프라인으로 제한한다

- 날짜: 2026-07-26
- 관련 장애: [Flyway 체크섬 불일치로 인한 운영 전면 장애](../trouble-shooting/2026-07-26-flyway-checksum-crashloop.md)
- 관련 선행 사례: [2026-07-23 크래시루프와 동작하지 않은 롤백](../trouble-shooting/2026-07-23-spring-context-crashloop-and-dead-rollback.md)

## 맥락

스키마를 바꾸는 경로가 네 개로 갈라져 있었다.

| 경로 | 이력 추적 | 실행 주체 |
|---|---|---|
| `App/backend_spring/src/main/resources/db/migration/V*.sql` | Flyway | Spring 부팅 시 |
| `App/backend_spring/src/main/resources/db/init/*.sql` | 없음 | 컨테이너 최초 기동 (로컬 `db`만) |
| `docs/db/migrations/0*.sql` | 없음 | 사람이 `for` 루프로 수동, 매 배포 재실행 |
| `supabase/migrations/*.sql` | Supabase CLI | 아무도 실행하지 않음 (위와 중복) |
| `docs/db/workflow_ai_schema.sql` | 없음 | 실행 경로 아님 — 2026-07-22 `supabase db dump` 스냅샷 |

다섯 번째 항목은 이 문서를 처음 쓸 때 놓쳤다. 마이그레이션이 아니라 운영 스냅샷이라 경로로
세지 않았는데, **운영에만 있고 다른 어디에도 없는 객체 21개가 여기에만 정의돼 있다**
(`workload_scores` 테이블, `uq_action_items_created_task`, 성능 인덱스 6개 등). 즉 이 파일은
운영 스키마가 어떻게 그렇게 됐는지 설명하지 못하고, 그렇다는 사실만 기록한다.

여기에 두 제약이 겹쳤다.

**운영 Supabase를 개발자 7명이 로컬에서 공유한다.** `flyway_schema_history`는 그 공유 DB에
하나뿐인데 기록 주체는 운영 서버 + 로컬 7대였다. (서버 Postgres로 이관할 계획이 있으나
당분간은 공유 상태를 유지한다.)

**문서·앱 설정·compose가 서로 다른 말을 했다.** `application.yml`과 `DEPLOY_OCI.md`는
`SPRING_FLYWAY_ENABLED` 기본값이 false라고 했는데 `docker-compose.yml`만 `:-true`였다.
compose로 띄울 때만 Flyway가 켜졌다.

2026-07-26, 한 개발자가 **push하지 않은 로컬 브랜치**로 공유 Supabase에 Flyway를 실행했다.
`main`에 없는 마이그레이션 2개가 운영에 적용됐고(`users.reviewer_rejection_reason` 생성),
`20260724.4`의 체크섬이 그 브랜치 기준으로 덮어씌워졌다. 28분 뒤 `main` 배포가 Flyway
검증에서 막혀 Spring이 크래시루프에 빠졌다. 자동 롤백은 정상 실행됐으나 **복구에 실패했다** —
롤백은 코드를 되돌리지만 문제는 DB 장부에 있었다. 운영 API가 41분 중단됐다.

## 선택

**1. 경로 일원화 — Flyway를 유일한 스키마 변경 경로로 한다.**
`docs/db/migrations`는 V파일로 이관 후 폐기, `supabase/migrations`는 삭제한다. `db/init`은
빈 DB 최초 부트스트랩 전용으로 역할을 고정한다.

이관본 14개는 운영 baseline(`20260721.1`) 아래 번호를 받으므로 운영에서는 재실행되지 않지만
**빈 DB에서도 실행되지 않는다.** 그래서 같은 내용을 `db/init/11_pre_baseline_backfill.sql`
(생성물)에 둔다. `initdb.d`는 빈 볼륨에서 한 번만 돌기 때문에 운영에는 영향이 없다.
중복이지만 baseline을 재설계할 때까지의 과도기 조치다 — 아래 "남은 divergence" 참조.

**2. 실행 주체 제한 — 3층 방어.**

- 1층: `docker-compose.yml`의 `SPRING_FLYWAY_ENABLED` 기본값을 `false`로 뒤집는다.
  운영 서버만 `.env`에 `true`를 명시한다. 켜는 쪽을 명시적으로 만든다.
  `SPRING_FLYWAY_OUT_OF_ORDER`는 체크섬 검증과 무관해 삭제한다.
- 2층: DB 롤을 분리한다. 앱 롤은 DML만, DDL은 배포 파이프라인이 쓰는 마이그레이션 롤에만.
  **OCI 자체호스팅 Postgres 이관 시점에 함께 수행한다.**
- 3층: 이미 적용된 V파일을 수정하는 PR을 CI에서 차단한다(`migration-guard`).
  2026-07-27 추가 — 같은 버전 번호를 가진 V파일이 둘 이상이면 함께 차단한다. 이 충돌은
  한 PR 안에서는 보이지 않고 두 PR이 합쳐질 때만 드러나므로 PR·push 양쪽에서 보고,
  배포를 실제로 막는 것은 `deploy-oci`의 `test` 잡이 같은 스크립트를 호출하는 쪽이다
  (`deploy`가 `test`에 의존한다 — 별도 워크플로인 `migration-guard`는 배포와 병렬로 돌아
  배포를 멈추지 못한다). 경위는
  [버전 중복과 preflight pending 오탐](../trouble-shooting/2026-07-27-flyway-duplicate-version-and-pending-preflight.md).

**3. 배포 게이트를 롤백에서 사전 검증으로 옮긴다.**
컨테이너 교체 전에 `flyway validate`를 돌린다(`Preflight Redis ACL` 옆). 실패하면 배포를
중단하고 실행 중인 서비스는 건드리지 않는다. 롤백 스텝에는 "Flyway 검증 실패는 코드 롤백으로
고쳐지지 않는다"는 판정을 넣어 20회 헛돌지 않게 한다.

## 버린 대안

**Flyway를 완전히 제거하고 수동 관리로 통일.** `DEPLOY_OCI.md`가 원래 말하던 방향이고
즉시 안정적이지만, 7명이 공유하는 DB에서 "누가 어디까지 적용했는지"를 영원히 사람이
추적해야 한다. 이번 장애의 반대편 실패(적용 누락, 007 재실행)를 부른다.

**Supabase CLI(`supabase/migrations`)로 일원화.** Supabase 네이티브하지만, 자체호스팅
Postgres로 이관할 때 도구를 다시 갈아야 한다.

**`flyway repair`로 체크섬만 맞추기.** 장부에 중복 적용 흔적 5개와 레포에 없는 버전 3개가
남아 다음 사람이 다시 헛갈린다. baseline 리셋으로 장부를 재생성했다(스키마는 무손상 —
50개 객체 전수 확인 후 진행).

**2층을 지금 Supabase에 적용.** 틈을 즉시 닫지만 롤 설계와 7명 `.env` 갱신을 이관 때 또
해야 한다. 그때까지의 공백은 1층·3층으로 완화한다.

## 남은 divergence — 빈 DB는 아직 운영과 같지 않다

2026-07-26 실측: `db/init`(백필 포함) + Flyway로 빈 DB를 만들어 운영과 객체 단위로 비교했다.
백필 도입으로 누락이 57개에서 30개로 줄었고, 줄어든 27개가 이관본 14개가 담당하는 부분이다
(pgvector 확장, `embedding` → `vector(1024)`, `rag_assignee_sync_failures` 등).

남은 30개는 전부 이 결정 이전부터 있던 차이다. 상세 표는
[DEPLOY_OCI.md 8절](../../App/DEPLOY_OCI.md)에 있고, 성격은 세 가지다.

- **`workflow_ai_schema.sql`에만 정의** (21개) — `workload_scores` 일체, 성능 인덱스 6개,
  `uq_action_items_created_task`. 이 중 유니크 제약만 실제 무결성 차이다.
- **어디에도 정의 없음** (5개) — `users.is_admin`·`faculty_id`·`reviewer_rejection_reason`,
  `tasks.done_date`, `evaluation_scores.total_score`. JPA 엔티티가 매핑하지 않으므로 신규
  환경 기동에는 영향이 없다. `total_score`는 머지되지 않은 `origin/contribution_score`
  브랜치에서 왔다 — 이번 장애와 같은 경로다.
- **이름·길이 차이** (FK 6개, varchar 10개) — 기능 동등. 운영이 더 느슨한 쪽이다.

이 divergence를 어떻게 정리할지는 **OCI 자체호스팅 Postgres 이관 시점의 baseline 재설계와
함께 결정한다.** 그때 baseline을 001 이전으로 내리면 이관본 14개가 정상 실행되고 백필 파일과
`workflow_ai_schema.sql`을 함께 폐기할 수 있다.

## 되돌리는 법

| 변경 | 되돌리기 |
|---|---|
| compose 기본값 `false` | `App/docker-compose.yml`에서 `:-true`로 복원 |
| `docs/db/migrations` 폐기 | git에서 디렉터리 복원 (DB 영향 없음 — 이미 적용된 내용) |
| `db/init/11_pre_baseline_backfill.sql` | 파일 삭제. 기존 볼륨에는 영향 없음(빈 볼륨에서만 실행) |
| `supabase/migrations` 삭제 | git에서 복원 |
| Preflight validate 스텝 | `.github/workflows/deploy-oci.yml`에서 해당 스텝 삭제 |
| `migration-guard` CI | `.github/workflows/migration-guard.yml` 삭제 |
| DB 권한 분리 (2층, 미시행) | 앱 롤에 DDL 권한 재부여 (`GRANT`) |

`flyway_schema_history`를 다시 초기화해야 한다면 **반드시 backend-spring 컨테이너를 먼저
정지한 뒤** DROP한다. 2026-07-26 복구 때 이 순서를 지키지 않아, 크래시루프 중이던 옛
컨테이너가 DROP 직후 깨어나 자기 기준으로 baseline을 찍었다.

현재 운영 baseline은 `20260721.1`, `flyway_schema_history` 9행이다. 장애 당시 장부 백업은
Supabase의 `flyway_schema_history_bak_20260726`(16행)에 있다.

## 후속 보강

- `V20260726_1`: `users.is_admin`, `faculty_id`, `reviewer_rejection_reason`
- `V20260727_1`: 중복됐던 RAG 실패 이력 마이그레이션 버전을 이동
- `V20260727_2`: `tasks.done_date`와 기존 완료 업무 백필
- `V20260727_3`: 사용자 프로필·약관·개인정보 동의 컬럼

당시 "어디에도 정의 없음"으로 분류했던 관리자·업무 완료일 컬럼과 init 전용이던 사용자
프로필·동의 컬럼은 위 신규 V파일로 운영 baseline 이후 경로에 편입했다. 적용 검증과 API
롤아웃 계약은 [FS3 스키마·API 변경 배포 계약](2026-07-26-fs3-schema-api-rollout.md)을 따른다.
