# 운영 데이터 초기화 런북

배포 전 운영 데이터를 전량 제거한다. **스키마는 유지**하고 아래 계정만 남긴다.

- 관리자 (`users.is_admin = true`)
- 구글 로그인 계정 (`users.provider = 'google'`) — 팀원 실계정

데모(`provider = 'demo'`), 로컬 테스트(`provider = 'local'`) 계정은 심사자 승인 계정을 포함해 전부 삭제한다.

단일 스크립트가 아니라 런북인 이유: 4단계(오브젝트 스토리지 삭제)는 백업이 없어 되돌릴 수 없고,
0단계에서 남길 계정을 눈으로 확인한 뒤에야 다음으로 넘어갈 수 있다. 사람이 단계마다 멈춰야 한다.

전제
- `ssh -i ~/.ssh/oci-key teamlead@161.33.132.66`
- **`docker compose`는 쓸 수 없다.** compose 프로젝트는 `/home/ubuntu/work-flow/App`에 있고 `ubuntu` 소유(`drwxr-x---`)라
  `teamlead`는 `.env`조차 읽지 못하며 sudo도 암호를 요구한다. 컨테이너 이름으로 `docker start/stop/exec`을 쓴다.
- **서버에서 git 명령을 sudo로 실행하지 말 것** (`.git` 오브젝트 소유권이 깨져 이후 배포가 막힌다)
- **`docker exec`에 SQL을 히어독으로 밀어 넣지 말 것.** `-i`가 없으면 stdin이 컨테이너 안 프로세스까지 전달되지 않아
  `psql`이 아무것도 읽지 못하고 **조용히 성공한 것처럼 끝난다**(출력도 오류도 없다). 그렇다고 `-i`를 주면 이번엔
  호출하는 쪽 스크립트를 stdin으로 삼킨다. 답은 둘 다 피하는 것 — **파일로 만들어 `docker cp` 후 `psql -f`로 실행**한다.
  한 줄짜리는 `-c`를 쓰고 끝에 `</dev/null`을 붙인다.

관련 문서: 복원 절차 전체는 [docs/db/2026-07-30-supabase-to-oci-cutover.md](../../docs/db/2026-07-30-supabase-to-oci-cutover.md)

---

## 0. 사전 확인 (파괴 작업 아님)

```sh
# (a) 남길 관리자가 실제로 누구인가. 여기서 예상과 다르면 중단한다.
docker exec workflow-db psql -U postgres -d workflow -c \
  "SELECT id, email, name, provider, is_admin FROM users ORDER BY id;" </dev/null

# (b) 데모 시드가 꺼져 있는가. SPRING_PROFILES_ACTIVE=prod 이면 기본 false지만,
#     .env에 WORKFLOW_DEMO_SEED_ENABLED=true가 박혀 있으면 재기동 시 데모 계정이 되살아난다.
docker inspect workflow-backend-spring --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E 'WORKFLOW_DEMO_SEED_ENABLED|SPRING_PROFILES_ACTIVE'

# (c) 버킷에 무엇이 들어있는가. tasks/ avatars/ 외에 db-backups/ 가 보여야 정상이다.
#     (자격증명은 4단계에서 컨테이너 env로 읽는다. 화면에 찍지 않는다.)
```

## 1. 앱 정지

큐 워커가 도는 중에 지우면 이미 사라진 회의/업무 id를 처리하려다 에러를 뱉는다.
DB·Redis·Kafka는 아직 살려 둔다 — 뒤 단계에서 접속해야 한다.

```sh
docker stop workflow-backend-spring workflow-backend-fastapi
```

## 2. 백업

기존 백업 스크립트를 그대로 쓴다. 덤프 → `pg_restore -l`로 열리는지 확인 → 오브젝트 스토리지 업로드까지
하고, 하나라도 실패하면 실패로 처리한다. 손으로 `pg_dump`를 치지 않는다.

```sh
~/bin/pg-backup.sh          # 또는 이 레포의 App/scripts/pg-backup.sh
```

`업로드 확인 완료` 로그와 `s3://<버킷>/db-backups/self-hosted/workflow_<STAMP>.dump` 경로를 받아 적어둔다.
되돌릴 때 이 파일이 유일한 수단이다.

## 3. DB 데이터 삭제

아래 SQL을 로컬에서 `reset-data.sql`로 저장해 서버로 보낸 뒤 `-f`로 실행한다(히어독 금지 — 전제 참고).

```sh
# 로컬에서
scp -i ~/.ssh/oci-key reset-data.sql teamlead@161.33.132.66:/tmp/reset-data.sql

# 서버에서
docker cp /tmp/reset-data.sql workflow-db:/tmp/reset-data.sql
docker exec workflow-db psql -U postgres -d workflow -f /tmp/reset-data.sql </dev/null
```

```sql
\set ON_ERROR_STOP on

BEGIN;

-- users / flyway 이력 테이블을 제외한 public 전 테이블 비우기.
-- 목록을 실행 시점 카탈로그에서 뽑아, 마이그레이션으로 테이블이 늘어도 누락되지 않게 한다.
-- flyway_schema_history_bak_* 같은 이력 백업본도 함께 제외한다(운영 데이터가 아니라 마이그레이션 안전장치).
DO $$
DECLARE targets text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO targets
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> 'users'
    AND tablename !~ '^flyway_schema_history';

  EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', targets);
END $$;

-- 관리자·구글 계정 외 전 계정 삭제 (데모/로컬 테스트 계정, 심사자 승인 계정 포함).
-- 반드시 위 TRUNCATE 다음이어야 한다: notifications.user_id, tasks.created_by,
-- meetings.uploaded_by, meeting_action_items.final_assignee_id / recommended_assignee_id 는
-- ON DELETE 규칙이 없어(NO ACTION) 참조가 남아 있으면 이 DELETE가 거부된다.
DELETE FROM users WHERE is_admin = false AND provider <> 'google';

-- 4단계에서 avatars/ 를 통째로 지우므로, 남은 관리자의 프로필 사진 경로도 같이 끊는다.
-- 안 하면 존재하지 않는 오브젝트를 가리켜 이미지가 깨진다.
UPDATE users SET profile_image_path = NULL WHERE profile_image_path IS NOT NULL;

COMMIT;
```

건드리지 않는 것과 그 이유

| 대상 | 이유 |
|---|---|
| `flyway_schema_history` | 지우면 다음 배포 때 적용 완료된 마이그레이션을 처음부터 재실행하려다 깨진다 |
| `flyway_schema_history_bak_*` | 위 이력의 백업본. 체크섬 문제 발생 시 되돌릴 근거 |
| `users_id_seq` 현재값 | 관리자 id가 살아있는데 1로 되돌리면 다음 가입에서 PK 충돌 |
| `vector` 확장 | 스키마를 유지하므로 재생성 불필요 |

## 4. 오브젝트 스토리지 삭제 — **되돌릴 수 없음**

**버킷을 통째로 지우면 안 된다.** 이 버킷에는 앱 파일뿐 아니라 2단계에서 올린 **DB 백업본이
`db-backups/` 아래 같이 들어 있다.** 통째로 지우면 방금 만든 유일한 복구 수단이 함께 사라진다.
반드시 `tasks/`와 `avatars/` 두 접두사만 지정해 지운다.

```sh
# 자격증명은 실행 중인 컨테이너에서 읽는다 (화면·로그에 찍지 않는다)
env_of() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null; }
SP="$(env_of workflow-backend-spring)"
EP="$(echo "$SP" | sed -n 's/^STORAGE_ENDPOINT=//p'   | head -1)"
BK="$(echo "$SP" | sed -n 's/^STORAGE_BUCKET=//p'     | head -1)"
RG="$(echo "$SP" | sed -n 's/^STORAGE_REGION=//p'     | head -1)"
AK="$(echo "$SP" | sed -n 's/^STORAGE_ACCESS_KEY=//p' | head -1)"
SK="$(echo "$SP" | sed -n 's/^STORAGE_SECRET_KEY=//p' | head -1)"

# OCI의 S3 호환 엔드포인트는 aws-cli v2가 기본으로 붙이는 체크섬 헤더를 거부한다.
# when_required로 낮춰야 통과한다 (pg-backup.sh, S3StorageClient.java와 같은 이유).
aws_s3() {
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="$AK" -e AWS_SECRET_ACCESS_KEY="$SK" \
    -e AWS_DEFAULT_REGION="$RG" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    amazon/aws-cli:latest s3 "$@" --endpoint-url "$EP"
}

# (a) 백업본이 실제로 버킷에 있는지 먼저 눈으로 확인한다
aws_s3 ls "s3://${BK}/db-backups/self-hosted/" | tail -5

# (b) 무엇이 지워지는지 먼저 본다 (--dryrun은 아무것도 지우지 않는다)
aws_s3 rm "s3://${BK}/tasks/"   --recursive --dryrun
aws_s3 rm "s3://${BK}/avatars/" --recursive --dryrun

# (c) 목록에 db-backups/ 가 한 줄도 없는 것을 확인한 뒤에만 실행한다
aws_s3 rm "s3://${BK}/tasks/"   --recursive
aws_s3 rm "s3://${BK}/avatars/" --recursive
```

## 5. Redis 비우기

담긴 것: 어시스턴트 스레드 소유권, 대시보드 workload 점수 캐시, `rag_epoch:*` 카운터,
대시보드/회의분석 AI 잡 큐. 전부 DB에서 재생성되는 파생 데이터라 통째로 비워도 된다.
ACL 사용자 정의는 keyspace가 아니라 설정 파일에 있어 `FLUSHALL`로 사라지지 않는다.

```sh
docker exec workflow-redis sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --user admin FLUSHALL' </dev/null
docker exec workflow-redis sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --user admin DBSIZE'   </dev/null   # 0 확인
```

FLUSHALL은 워커가 쓰는 Redis Stream과 소비자 그룹도 함께 지우지만, **앱을 재기동하면 다시 만든다**
(`dashboard-ai-jobs`, `rag-jobs`, `meeting-analysis` 3개가 6단계 이후 재생성되는 것으로 확인). 별도 조치 불필요.

## 6. 앱 기동

```sh
docker start workflow-backend-spring workflow-backend-fastapi
sleep 25 && docker ps --format '{{.Names}}\t{{.Status}}'
```

컨테이너 재생성(`--force-recreate`)은 필요 없다. 원래는 아래 둘을 지우려는 목적이었으나 실제로는 둘 다 비어 있다.

- `uploads/`(회의 오디오 원본, `WORKFLOW_UPLOADS_DIR`): 컨테이너 `/app` 아래에 **디렉터리 자체가 없다**
- Kafka 토픽: `kafka-topics.sh --list`가 **빈 결과**를 낸다. 회의 분석·대시보드 큐는 Kafka가 아니라
  **Redis Stream**으로 돌아가고 있어(5단계에서 정리됨) Kafka는 실질적으로 놀고 있다

둘 중 하나라도 채워져 있다면 그때는 `ubuntu` 권한으로 compose `--force-recreate`가 필요하다
(`restart`는 컨테이너 파일시스템을 유지하므로 소용없다).

## 7. 검증

**`pg_stat_user_tables.n_live_tup`으로 확인하지 말 것.** 통계 수집기가 나중에 갱신하는 추정치라
방금 지운 결과가 반영되지 않아 "안 지워진 것처럼" 보인다. 실제 `count(*)`로 센다.

```sh
# (a) 보존 대상만 남았는가 (profile_image_path는 전부 NULL이어야 한다)
docker exec workflow-db psql -U postgres -d workflow -c \
  "SELECT id, email, provider, is_admin, profile_image_path FROM users ORDER BY id;" </dev/null

# (b) users/flyway 외 잔여 행이 0인가
docker exec workflow-db psql -U postgres -d workflow -c \
  "SELECT sum(cnt) AS 잔여_데이터_행 FROM (
     SELECT (xpath('/row/c/text()', query_to_xml(
       format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS cnt
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> 'users' AND c.relname !~ '^flyway_schema_history') t;" </dev/null

# (c) 재기동 이후 오류가 없는가 (시각은 6단계 기동 시점으로 바꾼다)
docker logs --since <HH:MM:SS> workflow-backend-spring 2>&1 | grep -iE 'error|warn|exception' || echo '오류 없음'
```

`/actuator/health`는 prod에서 401을 낸다(보안 설정). 기동 확인은 로그의
`Started WorkFlowAiBackendApplication` 줄로 한다. FastAPI에는 `/health` 경로가 없어 404가 정상이다.

화면에서 확인할 것
- 관리자 계정으로 로그인되는가
- 프로젝트 목록이 비어 있는가
- 신규 프로젝트 생성 → 업무 생성 → 결과 파일 업로드가 되는가 (스토리지 경로가 살아있는지)

## 되돌리기

DB만 되돌아온다. **4단계에서 지운 파일은 복구 불가** — 복원 후 파일 메타데이터 행은 살아나지만
실제 오브젝트가 없어 다운로드가 실패한다.

```sh
docker stop workflow-backend-spring workflow-backend-fastapi

# 2단계에서 받아 적은 백업을 내려받는다 (4단계 aws_s3 함수 재사용)
aws_s3 cp "s3://${BK}/db-backups/self-hosted/workflow_<STAMP>.dump" ./restore.dump

docker cp ./restore.dump workflow-db:/tmp/restore.dump
docker exec workflow-db pg_restore -U postgres -d workflow \
  --clean --if-exists --no-owner --no-privileges /tmp/restore.dump </dev/null

docker start workflow-backend-spring workflow-backend-fastapi
```

---

## 실행 기록

### 2026-08-03 (배포 전 초기화)

- 보존: `admin@workflow.ai`(id 29) + 구글 계정 4개(id 5·6·7·8) = 5개
- 삭제: 26개 계정(데모 7, 로컬 테스트 16, 승인 심사자 3), 프로젝트 35, 업무 257, 활동 1004, 회의 44, 청크 451 등 전량
- 백업: `s3://workflow-ai-storage/db-backups/self-hosted/workflow_20260803T051005Z.dump` (2.2M, 31테이블, 검증 통과)
- 스토리지: `avatars/` 고아 파일 1개만 존재해 삭제. `tasks/` 접두사는 애초에 없었음(업무 결과 파일이 올라간 적 없음)
- Redis: 7키 → 0. 재기동 후 스트림 3개 자동 재생성 확인
- 결과: `users` 5행, flyway 이력 37+16행, 그 외 전 테이블 0행. 재기동 이후 오류 로그 없음
