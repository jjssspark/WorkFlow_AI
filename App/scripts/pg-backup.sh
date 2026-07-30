#!/usr/bin/env bash
#
# 운영 Postgres 일일 백업. cron에서 호출한다.
#
#   0 18 * * *  /home/teamlead/bin/pg-backup.sh >> /home/teamlead/backup/cron.log 2>&1
#
# 설계 의도
# ---------
# * 접속 정보를 이 스크립트나 별도 파일에 복사해 두지 않는다. 실행 중인 컨테이너의
#   환경변수에서 그때그때 읽는다. 그래서 Supabase → 자체 호스팅 컷오버 시점에
#   이 스크립트를 고칠 필요가 없다 - 앱이 보는 DB를 그대로 따라간다.
# * 서버 안에만 두지 않는다. 서버가 죽으면 백업도 함께 죽는다. OCI Object Storage로
#   올린 뒤에야 성공으로 친다.
# * 덤프 직후 pg_restore -l 로 열어본다. 열리지 않는 파일을 백업이라고 부르지 않는다.
#
# 되돌리는 법 / 복원 절차는 docs/db/2026-07-30-supabase-to-oci-cutover.md 참고.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/teamlead/backup}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-14}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-60}"
REMOTE_PREFIX="${REMOTE_PREFIX:-db-backups}"
AWS_IMAGE="${AWS_IMAGE:-amazon/aws-cli:latest}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${BACKUP_DIR}/workflow_${STAMP}.dump"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# 실패를 알릴 곳. 없으면 로그에만 남는다 - 조용히 죽는 백업을 막으려면 반드시 채워둔다.
#   printf '%s' 'https://hooks.slack.com/...' > ~/backup/slack-webhook && chmod 600 ~/backup/slack-webhook
notify() {
  local hook_file="${BACKUP_DIR}/slack-webhook"
  local hook="${SLACK_WEBHOOK_URL:-}"
  [ -z "$hook" ] && [ -r "$hook_file" ] && hook="$(cat "$hook_file")"
  [ -n "$hook" ] || return 0
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    --data "{\"text\":\"[DB 백업 실패] $(hostname): $1\"}" "$hook" >/dev/null 2>&1 || true
}

die() { log "FAIL: $*"; notify "$*"; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# --- 접속 정보 (실행 중인 컨테이너에서 읽는다. 화면·로그에 찍지 않는다) -------------
env_of() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null; }

DB_URL="$(env_of workflow-backend-fastapi | sed -n 's/^DATABASE_URL=//p' | head -1)"
[ -n "$DB_URL" ] || die "workflow-backend-fastapi에서 DATABASE_URL을 읽지 못했다"

# pg_dump는 Supabase 트랜잭션 풀러(6543)에서 동작하지 않는다. 세션 풀러(5432)로 바꾼다.
# 자체 호스팅(db:5432)에는 :6543이 없으므로 이 치환이 아무 영향도 주지 않는다.
DUMP_URL="${DB_URL/:6543/:5432}"

case "$DUMP_URL" in
  *pooler.supabase.com*) SOURCE_LABEL="supabase" ;;
  *@db:*|*@workflow-db:*) SOURCE_LABEL="self-hosted" ;;
  *)                      SOURCE_LABEL="unknown" ;;
esac
log "백업 대상: ${SOURCE_LABEL}"

# --- 1. 덤프 -----------------------------------------------------------------------
# docker exec에 -i를 주면 안 된다. 호출하는 쪽 스크립트를 stdin으로 삼킨다.
log "덤프 시작 → $(basename "$DUMP")"
docker exec -e PGURL="$DUMP_URL" workflow-db \
  sh -c 'pg_dump "$PGURL" -n public --no-owner --no-privileges -Fc' \
  > "$DUMP" </dev/null || die "pg_dump 실패"

SIZE=$(stat -c %s "$DUMP")
[ "$SIZE" -gt 100000 ] || die "덤프가 비정상적으로 작다 (${SIZE} bytes)"

# --- 2. 덤프가 실제로 열리는지 확인 --------------------------------------------------
# 여기까지 통과해야 백업이라고 부를 수 있다.
docker cp "$DUMP" workflow-db:/tmp/verify.dump >/dev/null
TABLES=$(docker exec workflow-db pg_restore -l /tmp/verify.dump </dev/null 2>/dev/null \
         | grep -c 'TABLE DATA' || true)
docker exec workflow-db rm -f /tmp/verify.dump </dev/null
[ "${TABLES:-0}" -ge 20 ] || die "덤프 목차에 테이블이 ${TABLES}개뿐이다 (20개 미만)"
log "덤프 확인 완료: $(numfmt --to=iec "$SIZE"), 테이블 ${TABLES}개"

# --- 3. 서버 밖으로 올린다 ------------------------------------------------------------
SP="$(env_of workflow-backend-spring)"
EP="$(echo "$SP" | sed -n 's/^STORAGE_ENDPOINT=//p'   | head -1)"
BK="$(echo "$SP" | sed -n 's/^STORAGE_BUCKET=//p'     | head -1)"
RG="$(echo "$SP" | sed -n 's/^STORAGE_REGION=//p'     | head -1)"
AK="$(echo "$SP" | sed -n 's/^STORAGE_ACCESS_KEY=//p' | head -1)"
SK="$(echo "$SP" | sed -n 's/^STORAGE_SECRET_KEY=//p' | head -1)"
[ -n "$EP" ] && [ -n "$BK" ] && [ -n "$AK" ] && [ -n "$SK" ] \
  || die "workflow-backend-spring에서 STORAGE_* 자격증명을 읽지 못했다"

# OCI의 S3 호환 엔드포인트는 aws-cli v2가 기본으로 붙이는 체크섬 헤더(aws-chunked)를
# 거부한다. when_required로 낮춰야 PUT이 통과한다 - S3StorageClient.java의
# chunkedEncodingEnabled(false)와 같은 이유다.
aws_s3() {
  docker run --rm \
    -v "${BACKUP_DIR}:/backup" -w /backup \
    -e AWS_ACCESS_KEY_ID="$AK" -e AWS_SECRET_ACCESS_KEY="$SK" \
    -e AWS_DEFAULT_REGION="$RG" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    "$AWS_IMAGE" s3 "$@" --endpoint-url "$EP"
}

REMOTE_KEY="${REMOTE_PREFIX}/${SOURCE_LABEL}/workflow_${STAMP}.dump"
log "업로드 → s3://${BK}/${REMOTE_KEY}"
aws_s3 cp "$(basename "$DUMP")" "s3://${BK}/${REMOTE_KEY}" >/dev/null \
  || die "업로드 실패 - 서버 밖 사본이 없으므로 실패로 처리한다"

# 올라간 크기가 실제로 같은지 확인한다.
REMOTE_SIZE=$(aws_s3 ls "s3://${BK}/${REMOTE_KEY}" 2>/dev/null | awk '{print $3}' | tail -1)
[ "$REMOTE_SIZE" = "$SIZE" ] \
  || die "업로드 크기 불일치 (로컬 ${SIZE} / 원격 ${REMOTE_SIZE:-없음})"
log "업로드 확인 완료"

# --- 4. 오래된 것 정리 ----------------------------------------------------------------
find "$BACKUP_DIR" -maxdepth 1 -name 'workflow_*.dump' -mtime "+${KEEP_LOCAL_DAYS}" -print -delete \
  | sed 's/^/[정리] /' || true

CUTOFF=$(date -u -d "${KEEP_REMOTE_DAYS} days ago" +%Y%m%d)
aws_s3 ls "s3://${BK}/${REMOTE_PREFIX}/${SOURCE_LABEL}/" 2>/dev/null \
  | awk '{print $4}' | grep '^workflow_' | while read -r key; do
      d="${key#workflow_}"; d="${d:0:8}"
      if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ] 2>/dev/null; then
        aws_s3 rm "s3://${BK}/${REMOTE_PREFIX}/${SOURCE_LABEL}/${key}" >/dev/null && echo "[정리] 원격 ${key}"
      fi
    done || true

log "완료: $(basename "$DUMP")"
