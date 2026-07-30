# Supabase → OCI 자체 호스팅 Postgres 컷오버 계획

- 날짜: 2026-07-30
- 대상: 운영 DB를 Supabase(`aws-1-ap-south-1.pooler.supabase.com`)에서 OCI 서버의
  `workflow-db` 컨테이너(`pgvector/pgvector:pg17`)로 옮긴다
- 선행 문서: [Supabase 스키마 드리프트](../trouble-shooting/2026-07-29-supabase-schema-drift.md),
  [Flyway 단일 경로 결정](../decisions/2026-07-26-flyway-single-migration-path.md)
- 상태: **리허설 완료, 컷오버 대기**

## 왜 옮기는가

인프라를 OCI 한 곳으로 모은다. 지금은 앱·Redis·Kafka·오브젝트 스토리지가 모두 OCI에
있는데 DB만 외부에 있다.

부수 효과가 하나 더 있다. 운영 Supabase를 개발자가 로컬에서 공유해 왔고, 그래서
`flyway_schema_history`가 하나뿐인데 기록 주체가 여럿이었다. 이 구조가 2026-07-26
체크섬 크래시루프와 2026-07-29 배포 중단의 배경이다. 서버 전용 DB로 옮기면 쓰기 주체가
배포 파이프라인 하나로 좁혀진다.

## 무엇이 이미 검증됐는가

운영 복사본을 별도 DB(`workflow_rehearsal`)에 복원해 원본과 대조했다. 운영 Supabase와
운영 `workflow` DB는 건드리지 않았다.

| 항목 | 원본(Supabase) | 리허설(OCI) |
|---|---|---|
| 테이블 | 32 | 32 |
| 총 행수 | 3,148 | 3,148 (테이블별 전부 일치) |
| 시퀀스 현재값 | 26개 | 26개 일치 |
| 외래키 | 51 | 51 (이름까지 일치) |
| PK / UNIQUE / CHECK | 31 / 9 / 2 | 동일 |
| 인덱스 / 트리거 | 60 / 7 | 60 / 7 |
| 벡터 임베딩 | 367행, 1024차원 | 367행, 1024차원 |
| Flyway 이력 | 31건 | 31건 |

시퀀스 일치가 특히 중요하다. 어긋나면 이관 직후 신규 등록마다 PK 충돌이 난다.

Postgres 버전은 양쪽 다 17이다(Supabase 17.6 → 컨테이너 17.10). `vector` 확장은
0.8.2 → 0.8.5로 올라간다(하위 호환).

## 발견된 함정 두 가지

컷오버 전에 반드시 알아야 한다. 둘 다 리허설에서 실제로 밟았다.

### 1. 확장을 복원 전에 만들어야 한다

`pg_dump -n public` 결과에는 `CREATE EXTENSION vector`가 **들어 있지 않다.** 확장은
스키마 소속이 아니라 데이터베이스 수준 객체라 `-n`으로 스키마를 한정하면 제외된다.

그대로 복원하면 `document_chunks`부터 실패한다.

```
ERROR: type "public.vector" does not exist
LINE 7:     embedding public.vector(1024),
```

반대로 `pgcrypto`·`uuid-ossp`는 **만들면 안 된다.** Supabase에서는 `extensions` 스키마에
있고, 실사용 여부를 조사한 결과 함수 본문 참조 0건, 컬럼 기본값 참조 0건이다. 굳이
`public`에 만들면 원본에 없던 함수 46개가 늘어 대조가 흐려진다. 앱 자체 함수는 양쪽 다
1개뿐이다.

### 2. 로컬 DB 비밀번호가 `.env`와 다르다 (조치 완료)

`POSTGRES_PASSWORD`는 **빈 볼륨 최초 기동 때만** 반영된다. 이 볼륨은 2026-07-20 00:27에
초기화됐고, 이후 `.env`가 바뀌었으나 DB 안의 비밀번호는 그대로였다.

이걸 놓치면 컷오버 당일 앱이 인증 실패로 뜨지 못한다. 앱은 컨테이너 네트워크로 붙고,
그 경로의 인증 방식은 `scram-sha-256`이기 때문이다.

**검증할 때 주의할 점이 있다.** 다음 확인은 아무것도 증명하지 못한다.

```sh
docker exec -e PGPASSWORD="$PW" workflow-db psql -h 127.0.0.1 -U postgres -c "select 1"
```

`pg_hba.conf`에서 `127.0.0.1`은 `trust`라 비밀번호를 아예 보지 않는다. 실제로 일부러
틀린 값을 넣어도 접속된다. 반드시 **컨테이너 네트워크 경유**로 확인해야 한다.

```sh
NET=$(docker inspect workflow-db --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NET" -e PGPASSWORD="$PW" postgres:17-alpine \
  psql -h workflow-db -U postgres -d postgres -tAc "select 'ok'"
```

2026-07-30 `.env` 값에 맞춰 정렬했고, 올바른 값은 통과 / 틀린 값은 거부되는 것까지
확인했다.

## Flyway 체크섬 문제는 이관과 별개로 함께 처리한다

현재 운영 배포는 `20260729.4` 체크섬 불일치로 막혀 있다(DB `2087721066` vs 파일
`1093102263`). 덤프에는 `flyway_schema_history`가 그대로 담기므로 **이관해도 따라온다.**
리허설에서 동일 증상을 재현했다.

리허설 DB에서 안전하게 판정한 결과는 다음과 같다.

| 실험 | 결과 |
|---|---|
| 현재 `V20260729_4`를 운영 복사본에 실행 | 스키마 431개 항목 중 **변경 0건** |
| 파일 끝의 7가지 검증 블록 | 예외 없이 통과 (종료코드 0) |
| `flyway repair` 후 `validate` | 초록, 이력 건수 31 유지 |

즉 운영 DB는 이미 현재 파일이 기술하는 상태다. `repair`로 체크섬을 갱신하는 것은 없는
사실을 기록하는 게 아니라 실제 상태를 반영하는 것이다. 컷오버 절차에 포함한다.

## `.env` 변경 — 5줄

```diff
- SPRING_DATASOURCE_URL=jdbc:postgresql://aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
+ SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/workflow
- SPRING_DATASOURCE_USERNAME=postgres.zzfcnbbzmbxzxptxghhq
+ SPRING_DATASOURCE_USERNAME=postgres
- SPRING_DATASOURCE_PASSWORD=<Supabase 비밀번호>
+ SPRING_DATASOURCE_PASSWORD=<POSTGRES_PASSWORD와 같은 값>
- DATABASE_URL=postgresql://postgres.zzfcnbbzmbxzxptxghhq:<...>@aws-1-...:6543/postgres?sslmode=require
+ DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@db:5432/workflow
- DATABASE_USE_TRANSACTION_POOLER=true
+ DATABASE_USE_TRANSACTION_POOLER=false
```

**`sslmode=require`를 빼야 한다.** 컨테이너 Postgres는 TLS를 켜지 않았으므로 남겨두면
접속이 전부 실패한다.

호스트는 컨테이너명(`workflow-db`)이 아니라 compose 서비스명 **`db`**다.

`DATABASE_USE_TRANSACTION_POOLER`는 `core/database_url.py`가 호스트명이
`.pooler.supabase.com`으로 끝날 때만 포트를 바꾸므로 사실상 무해하지만, 혼란을 남기지
않도록 함께 끈다.

### 함께 검토할 것 (선택)

`SPRING_DATASOURCE_HIKARI_MAX_POOL_SIZE=4`는 Supabase 풀러의 좁은 세션 한도에 맞춘
값이다. 자체 호스팅에는 그 제약이 없으므로 올릴 수 있다. 다만 컷오버와 같은 배포에서
바꾸면 문제가 생겼을 때 원인이 둘로 갈리므로, **컷오버가 안정된 뒤 별도로** 조정한다.

## 컷오버 절차

`teamlead` 계정은 `/home/ubuntu/work-flow`에 접근할 수 없다. 5번은 `ubuntu` 권한이
필요하다.

| # | 작업 | 소요 | 서비스 |
|---|---|---|---|
| 1 | Supabase 최신 덤프 | ~10초 | 정상 |
| 2 | `workflow` DB 재생성 + `CREATE EXTENSION vector` | ~5초 | 정상 |
| 3 | 복원 | ~30초 | 정상 |
| 4 | `flyway repair` | ~1초 | 정상 |
| 5 | `.env` 수정 (**ubuntu 권한**) | — | 정상 |
| 6 | 배포 실행 (컨테이너 재생성) | ~1~2분 | **중단** |
| 7 | 검증 | ~1분 | 복구 |

실제 중단은 6번뿐이고 평소 배포와 같은 수준이다.

**중단보다 데이터 유실 창이 중요하다.** 1번 덤프 이후 6번까지 사이에 사용자가 쓴 내용은
Supabase에만 남고 사라진다. 1~4를 붙여서 실행하면 2분 내외로 줄지만 0은 아니다.
사용이 적은 시간대를 고른다.

### 1~4. DB 준비

```sh
ssh -i ~/.ssh/oci-key teamlead@161.33.132.66

# 접속 문자열은 컨테이너 env에서 가져온다(화면에 찍지 않는다).
# pg_dump는 트랜잭션 풀러(6543)에서 동작하지 않으므로 세션 풀러(5432)로 바꾼다.
RAW=$(docker inspect workflow-backend-fastapi --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep '^DATABASE_URL=' | cut -d= -f2-)
SESS=$(echo "$RAW" | sed 's/:6543/:5432/')
PW=$(docker inspect workflow-db --format '{{range .Config.Env}}{{println .}}{{end}}' \
     | sed -n 's/^POSTGRES_PASSWORD=//p')
NET=$(docker inspect workflow-db --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')

mkdir -p ~/dbmig && chmod 700 ~/dbmig
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# 1) 덤프. docker exec에 -i를 주면 안 된다 - 뒤따르는 스크립트를 stdin으로 삼킨다.
docker exec -e PGURL="$SESS" workflow-db \
  sh -c 'pg_dump "$PGURL" -n public --no-owner --no-privileges -Fc' \
  > ~/dbmig/cutover_${STAMP}.dump </dev/null
ls -lh ~/dbmig/cutover_${STAMP}.dump

# 2) 대상 DB 재생성 + 확장 (확장을 먼저 만들어야 한다)
docker exec workflow-db psql -U postgres -d postgres -c \
  "DROP DATABASE IF EXISTS workflow" </dev/null
docker exec workflow-db psql -U postgres -d postgres -c \
  "CREATE DATABASE workflow" </dev/null
docker exec workflow-db psql -U postgres -d workflow -c \
  "CREATE EXTENSION IF NOT EXISTS vector" </dev/null

# 3) 복원. "schema public already exists" 오류 1건은 정상이다(Postgres가 기본 생성).
docker cp ~/dbmig/cutover_${STAMP}.dump workflow-db:/tmp/cutover.dump
docker exec workflow-db pg_restore -U postgres -d workflow \
  --no-owner --no-privileges /tmp/cutover.dump </dev/null

# 4) 체크섬 정렬. 마이그레이션 SQL이 서버에 필요하다(아래 주석 참고).
docker run --rm --network "$NET" \
  -e FLYWAY_URL="jdbc:postgresql://workflow-db:5432/workflow" \
  -e FLYWAY_USER=postgres -e FLYWAY_PASSWORD="$PW" \
  -v ~/dbmig/sql/migration:/flyway/sql:ro flyway/flyway:11.7.2 \
  -locations=filesystem:/flyway/sql \
  -baselineOnMigrate=true -baselineVersion=20260721.1 \
  -ignoreMigrationPatterns="*:pending" \
  repair
```

마이그레이션 SQL은 로컬 체크아웃에서 보낸다. macOS `tar`는 `._` 동반 파일을 만들어
Flyway가 "파일명 규칙 위반"으로 경고하므로 지운다.

```sh
# 로컬에서
tar -cz -C App/backend_spring/src/main/resources/db migration \
  | ssh -i ~/.ssh/oci-key teamlead@161.33.132.66 \
    'rm -rf ~/dbmig/sql && mkdir -p ~/dbmig/sql && tar -xz -C ~/dbmig/sql && rm -f ~/dbmig/sql/migration/._*'
```

Flyway CLI는 `-password=` 인자로 넘기면 값에 따라 파싱이 깨진다. 위처럼
`FLYWAY_PASSWORD` 환경변수를 쓴다.

### 5. `.env` 수정 (ubuntu 권한)

위 "`.env` 변경" 절의 5줄을 반영한다. 되돌릴 수 있도록 먼저 사본을 남긴다.

```sh
sudo cp /home/ubuntu/work-flow/App/.env /home/ubuntu/work-flow/App/.env.bak-20260730
sudo -e /home/ubuntu/work-flow/App/.env
```

### 6. 배포

컨테이너는 생성 시점에 환경변수가 고정되므로 `docker restart`로는 반영되지 않는다.
`docker compose up -d`로 **재생성**해야 한다. 평소처럼 배포 파이프라인을 태우는 것이
가장 안전하다 — 배포에는 Flyway preflight가 포함돼 있어 잘못된 설정을 컨테이너 교체
**이전에** 잡아준다.

### 7. 검증

```sh
# (a) 앱이 실제로 로컬 DB를 보는가
docker inspect workflow-backend-spring --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep SPRING_DATASOURCE_URL
docker inspect workflow-backend-fastapi --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep '^DATABASE_URL' | sed -E 's#(://[^:]+:)[^@]*@#\1<가림>@#'

# (b) 헬스체크
curl -s -o /dev/null -w '%{http_code}\n' https://t3-workflow-ai.site/api/v1/health/ready

# (c) 로컬 DB에 실제 트래픽이 붙었는가 (0이면 아직 Supabase를 보고 있는 것)
docker exec workflow-db psql -U postgres -d workflow -tAc \
  "select count(*) from pg_stat_activity where datname='workflow' and backend_type='client backend'"

# (d) 데이터가 보이는가
docker exec workflow-db psql -U postgres -d workflow -tAc \
  "select 'users='||(select count(*) from users)||' tasks='||(select count(*) from tasks)"

# (e) Spring 로그에 Flyway/DB 오류가 없는가
docker logs --tail 200 workflow-backend-spring | grep -iE "flyway|sqlstate|connection" | tail -20
```

화면 확인도 반드시 한다 — 로그인, 대시보드, 업무 보드, 회의록 목록.

## 되돌리기

`.env`의 5줄을 원래대로 되돌리고 다시 배포한다.

```sh
sudo cp /home/ubuntu/work-flow/App/.env.bak-20260730 /home/ubuntu/work-flow/App/.env
# 이후 배포 재실행
```

Supabase는 그대로 살아 있으므로 **되돌린 시점의 데이터가 온전하다.** 다만 컷오버 이후
로컬 DB에 쌓인 쓰기는 되돌리면 사라진다. 그래서 성공 판정을 빨리 내려야 한다.

**성공을 확실히 확인하기 전까지 Supabase 프로젝트를 지우지 않는다.** 최소 2주는 둔다.

## 컷오버 직후 반드시 할 일 — 백업

이관하면 Supabase의 관리형 백업이 사라진다. 현재 자체 백업은 **없다.** 이 상태로 두면
볼륨 하나가 날아갈 때 복구 수단이 없다.

최소한 일일 `pg_dump`를 걸고, 서버 밖(오브젝트 스토리지)으로 복사한다. 서버 안에만
두면 서버가 죽을 때 백업도 함께 죽는다. 오브젝트 스토리지는 이미
`compat.objectstorage.ap-tokyo-1.oraclecloud.com`을 쓰고 있으므로 자격 증명이 있다.

복원 절차도 함께 기록하고 **실제로 한 번 복원해 본다.** 해보지 않은 백업은 백업이 아니다.

## 컷오버 후 정리할 것

- `App/backend_fastapi/core/database_url.py:43`의 Supabase 풀러 분기 — 호스트명이
  `.pooler.supabase.com`으로 끝날 때만 동작하므로 당장은 무해하나 더 이상 쓰이지 않는다
- **사용자에게 보이는 문구 2곳**이 "Supabase"를 그대로 노출한다. 이관하면 사실과 달라진다.
  - `App/frontend/src/dashboard/screen/DashboardView.tsx:154`
    — "프로젝트를 선택하면 Supabase에 저장된 대시보드 데이터가 표시됩니다."
  - `App/frontend/src/dashboard/screen/detail/AllTasksPage.tsx:372`
    — "Supabase 실시간 조회 결과"
- 주석 2곳 (동작에는 영향 없음)
  - `App/frontend/src/board/components/TaskResultPanel.tsx:52` — 첨부파일 저장소를
    "Supabase Storage"라고 적었으나 실제로는 OCI Object Storage다
  - `App/backend_spring/src/main/java/com/workflowai/task/S3StorageClient.java:24`
    — 같은 오해. 운영 `STORAGE_ENDPOINT`는 이미
    `compat.objectstorage.ap-tokyo-1.oraclecloud.com`이다
- `App/DEPLOY_OCI.md`의 DB 관련 서술

## 미해결 / 판단 필요

**RLS가 32개 테이블 전부에 켜져 있는데 정책은 0건이다.** 앱은 테이블 소유자(`postgres`)로
붙으므로 RLS를 우회해 지금은 문제가 없다. Supabase에서 익명 API 역할을 차단하려던
설정으로 보이는데, 자체 호스팅에는 그런 공개 API가 없어 사실상 무의미해진다. 남겨두면
나중에 비소유자 역할을 만들 때 아무 행도 못 보는 함정이 된다. 정리 여부는 별도 판단.

**`db/init/*.sql`은 빈 볼륨 최초 기동에만 실행된다.** 이번 컷오버는 기존 볼륨 위에
`DROP DATABASE`/`CREATE DATABASE`로 진행하므로 init 스크립트는 돌지 않는다. 의도한
동작이다 — 스키마는 덤프에서 온다. 다만 볼륨을 새로 만드는 상황(서버 재구축 등)에서는
init 스크립트가 먼저 돌아 덤프 복원과 충돌하므로, 그때는 `CREATE DATABASE` 직후
복원하는 이 절차를 그대로 따른다.
