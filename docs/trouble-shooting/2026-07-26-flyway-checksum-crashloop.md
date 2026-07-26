# Flyway 체크섬 불일치로 인한 운영 전면 장애

- 날짜: 2026-07-26
- 범위: `App/backend_spring`, 공유 Supabase, `.github/workflows/deploy-oci.yml`
- 영향: 운영 API 전면 중단 (06:38~07:19 UTC, 약 41분 / 배포 실패 확정 06:51부터 28분)
- 관련 실행: Actions run `30191388671` (실패)
- 후속 결정: [스키마 변경 경로 Flyway 일원화](../decisions/2026-07-26-flyway-single-migration-path.md)
- 유사 사례: [2026-07-23 크래시루프와 동작하지 않은 롤백](2026-07-23-spring-context-crashloop-and-dead-rollback.md)

## 증상

`https://t3-workflow-ai.site/`는 200을 반환하는데 `/api/v1/health/ready`가 502였다.
프론트만 살아 있어 겉보기엔 정상으로 보였다. 07-23 장애와 같은 착시다.

```text
workflow-backend-spring   Up 3 seconds   restarts=56
workflow-redis            Up 29 hours (healthy)
workflow-db               Up 5 days (healthy)
workflow-kafka            Up 6 days
```

Spring만 재기동을 반복했다. Redis·DB·Kafka·FastAPI는 정상이고 큐 적체도 없었다
(`XLEN meeting-analysis` = 0, `XPENDING` = 0).

## 원인

```text
org.flywaydb.core.api.exception.FlywayValidateException: Validate failed
Migration checksum mismatch for migration version 20260724.4
-> Applied to database : 1152280100
-> Resolved locally    :  587121989
```

Flyway는 부팅 시 `flyway_schema_history`의 각 행과 로컬 V파일의 체크섬을 대조하고,
어긋나면 마이그레이션을 시작하지 않고 예외를 던진다. 이 검증은 `entityManagerFactory`
생성보다 앞이라 실패하면 애플리케이션 컨텍스트 전체가 뜨지 않는다. `HealthController`도
같이 죽어 liveness·readiness가 동시에 502가 된다.

### 왜 체크섬이 어긋났나 — 처음 세운 가설은 틀렸다

`V20260724_4`는 2026-07-25 `e92bce6`으로 수정됐다("컬럼 rename 멱등화"). 처음에는 이
사후 수정이 원인이라고 판단했다. **틀렸다.**

`e92bce6`은 2026-07-25 01:04 UTC에 PR #312로 `main`에 들어왔고, 그 뒤 배포가 **세 번
연속 성공**했다.

```text
07-25 01:04Z  e92bce6이 main 진입 (파일 체크섬 587121989)
07-25 08:04Z  배포 성공
07-25 08:29Z  배포 성공
07-26 02:39Z  배포 성공
07-26 05:31Z  ← 이 시점에 무언가 일어남
07-26 06:38Z  배포 실패 → 크래시루프
```

05:31 UTC에 `flyway_schema_history`에 두 행이 추가됐다.

```text
15 | 20260724.11 | rag assignee sync failures | 07-26 05:31
16 | 20260726.1  | admin reviewer approval    | 07-26 05:31
```

두 버전 모두 `main`에 없다. `20260724.11`은 `origin/contribution_score` 브랜치에만 있고,
`20260726.1`은 **origin 어느 브랜치에도 없다** — push되지 않은 로컬 브랜치다.
`users.reviewer_rejection_reason` 컬럼이 그때 운영 DB에 생겼다.

즉 **어떤 개발자가 자기 로컬 브랜치로 공유 Supabase에 Flyway를 실행했다.** 그 브랜치에는
`e92bce6`이 없으므로 `V20260724_4`의 내용이 수정 전 버전이었고, 그 값(`1152280100`)이
장부에 덮어씌워졌다. 다음 `main` 배포가 죽었다.

정리하면 원인은 "파일을 사후 수정한 것"이 아니라 **공유 운영 DB에 로컬에서 마이그레이션을
실행할 수 있는 구조**다.

## 롤백은 실행됐고, 그래도 실패했다

07-23 문서에서 다룬 fail-closed 차단과 달리 이번엔 롤백이 정상 실행됐다.

```text
06:47:29Z  Rollback to previous commit ...
06:48:04Z  still not healthy after rollback (attempt 1, code=502)
   ...      (20회 반복)
06:51:38Z  rollback did NOT restore a healthy state — manual intervention required
```

롤백은 코드를 `deploy-previous` 태그로 되돌린다. 그러나 문제는 DB 장부에 있었다. 어떤
코드로 돌아가도 `flyway_schema_history`의 체크섬은 그대로다. **코드 롤백으로 고칠 수 없는
장애에 롤백을 20번 시도한 것**이다.

## 조치

### 1. 실측 검증 — 장부만 오염됐고 실물은 온전한지 확인

baseline 리셋은 "여기까지 적용됐다"고 선언하는 것이라, 실제로 빠진 스키마가 있는데
덮어버리면 영구 미적용이 된다. 먼저 전수 조회했다.

```text
컬럼 30/30 OK   테이블 6/6 OK   인덱스 10/10 OK   제약 3/3 OK   확장 1/1 OK
MISSING: 0
evaluation_scores.is_public 잔재 없음 (rename 완료)
document_chunks.embedding = vector(1024), 185행 중 185행 임베딩 보존
```

`docs/db/migrations/009·010`(readiness가 검사하는 것) 포함 전부 존재했다.

### 2. 이력 백업 후 재생성

```sql
CREATE TABLE flyway_schema_history_bak_20260726 AS SELECT * FROM flyway_schema_history;
DROP TABLE flyway_schema_history;
```

`.env`도 `App/.env.bak-20260726-071924`로 백업한 뒤 backend-spring을 재기동했다.

### 3. 결과

```text
readiness (외부)  HTTP 200
재시작 카운트      0
users 26 / projects 27 / tasks 196 / meetings 15
document_chunks   185행 중 185행 임베딩 보존
제약조건 6개       각 1개 (중복 생성 없음)
```

재생성된 이력은 레포와 정확히 일치하는 9행이 됐다.

## 함정 — 복구 순서를 틀렸다

`DROP TABLE`을 실행할 때 **크래시루프 중이던 옛 컨테이너가 아직 살아 있었다.**
`restart: unless-stopped` 때문에 10초 주기로 계속 깨어나던 그 컨테이너가 DROP 직후 부팅에
성공해, 자기 환경변수 기준(기본값 `20260721.1`)으로 baseline을 찍고 V파일 전량을 재실행해
버렸다. 새로 주입한 `SPRING_FLYWAY_BASELINE_VERSION=20260726.1`은 그 뒤 재생성된 컨테이너에
들어갔지만 이미 이력 테이블이 존재해 쓰이지 않았다.

**이력 테이블을 초기화할 때는 반드시 컨테이너를 먼저 정지할 것.**

결과가 정상인 것은 운이었다. 다만 이 사고가 사실 하나를 증명했다 —
**`V20260722_1`~`V20260724_4`는 이미 적용된 DB에 전량 재실행해도 안전하다.** 9개 전부
성공했고 제약조건 중복 생성도 없었다. 비-`IF NOT EXISTS` 구문(`fk_meetings_original` 등)도
통과했다.

## 남은 것

- `App/.env`의 `SPRING_FLYWAY_BASELINE_VERSION=20260726.1` — 실제 baseline(`20260721.1`)과
  불일치. 지금은 무해하나 다음 초기화 때 V파일을 조용히 건너뛰게 만드는 지뢰다. 제거할 것.
- `flyway_schema_history_bak_20260726` (16행), `App/.env.bak-20260726-071924` — 안정화 후 삭제.
- `users.reviewer_rejection_reason` — origin에 없는 유령 컬럼. 정식 V파일로 올리거나 제거.
- 구조적 재발 방지는 [결정 기록](../decisions/2026-07-26-flyway-single-migration-path.md) 참조.
