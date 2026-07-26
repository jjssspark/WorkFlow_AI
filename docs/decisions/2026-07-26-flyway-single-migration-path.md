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

**2. 실행 주체 제한 — 3층 방어.**

- 1층: `docker-compose.yml`의 `SPRING_FLYWAY_ENABLED` 기본값을 `false`로 뒤집는다.
  운영 서버만 `.env`에 `true`를 명시한다. 켜는 쪽을 명시적으로 만든다.
  `SPRING_FLYWAY_OUT_OF_ORDER`는 체크섬 검증과 무관해 삭제한다.
- 2층: DB 롤을 분리한다. 앱 롤은 DML만, DDL은 배포 파이프라인이 쓰는 마이그레이션 롤에만.
  **OCI 자체호스팅 Postgres 이관 시점에 함께 수행한다.**
- 3층: 이미 적용된 V파일을 수정하는 PR을 CI에서 차단한다(`migration-guard`).

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

## 되돌리는 법

| 변경 | 되돌리기 |
|---|---|
| compose 기본값 `false` | `App/docker-compose.yml`에서 `:-true`로 복원 |
| `docs/db/migrations` 폐기 | git에서 디렉터리 복원 (DB 영향 없음 — 이미 적용된 내용) |
| `supabase/migrations` 삭제 | git에서 복원 |
| Preflight validate 스텝 | `.github/workflows/deploy-oci.yml`에서 해당 스텝 삭제 |
| `migration-guard` CI | `.github/workflows/migration-guard.yml` 삭제 |
| DB 권한 분리 (2층, 미시행) | 앱 롤에 DDL 권한 재부여 (`GRANT`) |

`flyway_schema_history`를 다시 초기화해야 한다면 **반드시 backend-spring 컨테이너를 먼저
정지한 뒤** DROP한다. 2026-07-26 복구 때 이 순서를 지키지 않아, 크래시루프 중이던 옛
컨테이너가 DROP 직후 깨어나 자기 기준으로 baseline을 찍었다.

현재 운영 baseline은 `20260721.1`, `flyway_schema_history` 9행이다. 장애 당시 장부 백업은
Supabase의 `flyway_schema_history_bak_20260726`(16행)에 있다.
