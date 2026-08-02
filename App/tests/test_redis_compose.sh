#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="${repo_root}/App"
tmp_dir="$(mktemp -d)"
project_name="workflow-redis-acl-test-$$"
smoke_override="${tmp_dir}/smoke.override.yml"
enqueue_script="${app_dir}/backend_spring/src/main/resources/redis/meeting-analysis-enqueue.lua"
enqueue_script_container="/run/workflow-redis/meeting-analysis-enqueue.lua"
smoke_started=0
smoke_completed=0
smoke_mode="${RUN_REDIS_SMOKE:-auto}"

case "${smoke_mode}" in
  0|1|auto) ;;
  *)
    printf '%s\n' "RUN_REDIS_SMOKE must be 0, 1, or auto" >&2
    exit 1
    ;;
esac

cleanup() {
  if [ "${smoke_started}" -eq 1 ]; then
    docker compose \
      --project-name "${project_name}" \
      --env-file "${tmp_dir}/compose.env" \
      -f "${app_dir}/docker-compose.yml" \
      -f "${app_dir}/docker-compose.prod.yml" \
      -f "${smoke_override}" \
      down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

chmod 700 "${tmp_dir}"
cat >"${tmp_dir}/compose.env" <<'EOF'
POSTGRES_PASSWORD=TestPostgresPassword_1234567890
DATABASE_URL=postgresql://postgres:test@db:5432/workflow
SPRING_DATASOURCE_PASSWORD=TestPostgresPassword_1234567890
JWT_SECRET=TestJwtSecret_12345678901234567890
RAG_INTERNAL_API_KEY=TestRagKey_123456789012345678901
GOOGLE_CLIENT_ID=test-client-id
GOOGLE_CLIENT_SECRET=TestGoogleSecret_1234567890123456
HUGGINGFACEHUB_API_TOKEN=TestHuggingFaceToken_1234567890123
REDIS_ADMIN_PASSWORD=AdminPassword_123456789012345678
REDIS_SPRING_PASSWORD=SpringPassword_12345678901234567
REDIS_FASTAPI_PASSWORD=FastApiPassword_1234567890123456
REDIS_HOST_PORT=16379
REDIS_MAXMEMORY=64mb
EOF
chmod 600 "${tmp_dir}/compose.env"
cat >"${smoke_override}" <<EOF
services:
  redis:
    container_name: ${project_name}-redis
    volumes:
      - ${enqueue_script}:${enqueue_script_container}:ro
EOF
chmod 600 "${smoke_override}"

rendered_config="${tmp_dir}/compose.json"
base_rendered_config="${tmp_dir}/base-compose.json"
smoke_rendered_config="${tmp_dir}/smoke-compose.json"
docker compose \
  --env-file "${tmp_dir}/compose.env" \
  -f "${app_dir}/docker-compose.yml" \
  config --format json >"${base_rendered_config}"
chmod 600 "${base_rendered_config}"

docker compose \
  --env-file "${tmp_dir}/compose.env" \
  -f "${app_dir}/docker-compose.yml" \
  -f "${app_dir}/docker-compose.prod.yml" \
  config --format json >"${rendered_config}"
chmod 600 "${rendered_config}"
docker compose \
  --env-file "${tmp_dir}/compose.env" \
  -f "${app_dir}/docker-compose.yml" \
  -f "${app_dir}/docker-compose.prod.yml" \
  -f "${smoke_override}" \
  config --format json >"${smoke_rendered_config}"
chmod 600 "${smoke_rendered_config}"

python3 - "${rendered_config}" "${base_rendered_config}" "${smoke_rendered_config}" \
  "${enqueue_script}" "${enqueue_script_container}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
with open(sys.argv[2], encoding="utf-8") as stream:
    base_config = json.load(stream)
with open(sys.argv[3], encoding="utf-8") as stream:
    smoke_config = json.load(stream)

services = config["services"]
redis = services["redis"]
spring = services["backend-spring"]
fastapi = services["backend-fastapi"]

assert not redis.get("ports"), "production Redis must not publish a host port"
assert any(
    volume.get("source") == "redis-data" and volume.get("target") == "/data"
    for volume in redis.get("volumes", [])
), "Redis must mount the redis-data named volume at /data"

base_redis_ports = base_config["services"]["redis"].get("ports", [])
assert len(base_redis_ports) == 1, "base Redis must publish exactly one loopback port"
assert base_redis_ports[0].get("host_ip") == "127.0.0.1"
assert str(base_redis_ports[0].get("published")) == "16379"
assert int(base_redis_ports[0].get("target")) == 6379
assert any(
    volume.get("type") == "bind"
    and volume.get("source") == sys.argv[4]
    and volume.get("target") == sys.argv[5]
    and volume.get("read_only") is True
    for volume in smoke_config["services"]["redis"].get("volumes", [])
), "runtime smoke must mount the production enqueue Lua resource read-only"

command = " ".join(redis.get("command", []))
for expected in (
    "--appendonly yes",
    "--appendfsync everysec",
    "--maxmemory-policy noeviction",
    "--maxmemory 64mb",
    "--auto-aof-rewrite-percentage 50",
    "--auto-aof-rewrite-min-size 16mb",
):
    assert expected in command, f"Redis command is missing {expected}"

redis_env = redis["environment"]
assert redis_env["REDIS_ADMIN_PASSWORD"] == "AdminPassword_123456789012345678"
assert redis_env["REDIS_SPRING_PASSWORD"] == "SpringPassword_12345678901234567"
assert redis_env["REDIS_FASTAPI_PASSWORD"] == "FastApiPassword_1234567890123456"

spring_env = spring["environment"]
assert spring_env["REDIS_USERNAME"] == "spring"
assert spring_env["REDIS_PASSWORD"] == redis_env["REDIS_SPRING_PASSWORD"]
assert spring.get("stop_grace_period") in ("60s", "1m0s")

fastapi_env = fastapi["environment"]
assert fastapi_env["REDIS_USERNAME"] == "fastapi"
assert fastapi_env["REDIS_PASSWORD"] == redis_env["REDIS_FASTAPI_PASSWORD"]

healthcheck = " ".join(redis["healthcheck"]["test"])
assert "REDISCLI_AUTH" in healthcheck
assert "--user admin" in healthcheck
assert "--pass" not in healthcheck
PY

for variable in REDIS_ADMIN_PASSWORD REDIS_SPRING_PASSWORD REDIS_FASTAPI_PASSWORD; do
  grep -Eq "${variable}: *\\$\\{${variable}:\\?" "${app_dir}/docker-compose.prod.yml"
  grep -q "^${variable}=$" "${app_dir}/.env.example"
done
grep -q '^REDIS_HOST_PORT=6379$' "${app_dir}/.env.example"
grep -q '^REDIS_MAXMEMORY=512mb$' "${app_dir}/.env.example"
grep -Fq "'127.0.0.1:\${REDIS_HOST_PORT:-6379}:6379'" "${app_dir}/docker-compose.yml"
grep -Fq -- '--maxmemory' "${app_dir}/docker-compose.yml"
grep -Fq -- '${REDIS_MAXMEMORY:-512mb}' "${app_dir}/docker-compose.yml"
grep -Fq -- '--auto-aof-rewrite-percentage' "${app_dir}/docker-compose.yml"
grep -Fq -- '--auto-aof-rewrite-min-size' "${app_dir}/docker-compose.yml"

grep -q 'user default off' "${app_dir}/redis/users.acl.template"
grep -Fq 'user admin on >__ADMIN_PASSWORD__ ~* &* +@all' "${app_dir}/redis/users.acl.template"
# 앱 계정 검사를 줄 전체 고정 문자열에서 성질별 검사로 바꿨다(2026-08-02).
#
# 고정 문자열은 선택자를 하나 추가할 때마다 깨지는데, 이 스크립트는 CI에서 돌지 않아
# 아무도 모른 채 방치됐다 - 2026-07-30 ACL 보강 이후 spring/fastapi 두 줄이 모두 템플릿과
# 어긋나 있었다. 즉 "ACL을 지키는 테스트"가 실제로는 아무것도 지키지 않고 있었다.
#
# 그래서 두 가지를 나눠 본다.
#   1. 거부 기본값(posture) - 여기가 무너지면 나머지 검사가 무의미하다
#   2. 코드가 실제로 쓰는 키 묶음이 열려 있는가 - 빠지면 런타임 NOPERM 으로 조용히 죽는다
# 선택자를 추가해도 1은 안 깨지고, 2는 기능이 바뀔 때만 같이 고치면 된다.
acl_template="${app_dir}/redis/users.acl.template"

assert_contains() {
  file="$1"
  expected="$2"
  description="$3"
  if ! grep -Fq "${expected}" "${file}"; then
    printf 'missing %s in %s\n' "${description}" "${file}" >&2
    exit 1
  fi
}

for service_user in spring fastapi; do
  password_placeholder="$(printf '%s' "${service_user}" | tr '[:lower:]' '[:upper:]')"
  grep -Eq "^user ${service_user} on >__${password_placeholder}_PASSWORD__ resetkeys resetchannels -@all " \
    "${acl_template}" || {
    printf '%s\n' "${service_user} must start from deny-all with keys and channels reset" >&2
    exit 1
  }
  # 앱 계정에 전체 키/채널/명령을 주면 계정을 나눈 의미가 사라진다.
  if grep -E "^user ${service_user} " "${acl_template}" | grep -Eq '(~\*|&\*|\+@all)'; then
    printf '%s\n' "${service_user} must not receive all keys, channels, or commands" >&2
    exit 1
  fi
done

# 코드가 실제로 쓰는 키 묶음. 여기가 비면 기능이 통째로 죽는다(2026-07-30 실측).
for selector in \
  '(~meeting-analysis ~dashboard-ai-jobs ' \
  '(~dashboard-ai-inflight:* ' \
  '(~dashboard-ai-done:* ' \
  '(~assistant_thread:* ' \
  '(~dashboard:workload-score:* ' \
  '(~rag-jobs ' \
  '&rag-result:*' \
  '(~meeting_analysis:* ~rag_answer:* ' \
  '(~rag_epoch:* +get +incr)' \
  '(~rag_stats:* +hincrby +expire +hgetall)'; do
  assert_contains "${acl_template}" "${selector}" "ACL selector ${selector}"
done

# 통계는 파이프라인을 transaction=False 로 연다. 여기에 +multi/+exec 가 생겼다면
# 코드가 트랜잭션을 쓰기 시작했다는 뜻이니 양쪽을 같이 확인해야 한다.
if grep -E '^user fastapi ' "${acl_template}" | grep -Eq '\+(multi|exec)'; then
  printf '%s\n' "fastapi does not use MULTI/EXEC; remove the grant or update rag_stats" >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])\+client([[:space:]]|$)' "${app_dir}/redis/users.acl.template"; then
  printf '%s\n' "Redis service users must not receive all CLIENT subcommands" >&2
  exit 1
fi
grep -q 'chmod 600' "${app_dir}/redis/redis-entrypoint.sh"
grep -Eq '영문 대소문자.*숫자.*_.*-' "${app_dir}/.env.example"
test -f "${enqueue_script}"
grep -Fq "redis.acl_check_cmd('XLEN'" "${enqueue_script}"
grep -Fq "redis.acl_check_cmd('XADD'" "${enqueue_script}"
grep -Fq "return 'QUEUE_FULL'" "${enqueue_script}"
grep -Fq 'ClassPathResource("redis/meeting-analysis-enqueue.lua")' \
  "${app_dir}/backend_spring/src/main/java/com/workflowai/meeting/MeetingAnalysisJobPublisher.java"

workflow="${repo_root}/.github/workflows/deploy-oci.yml"
runbook="${app_dir}/DEPLOY_OCI.md"
troubleshooting="${repo_root}/docs/trouble-shooting/2026-07-23-redis-queue-oci.md"

assert_contains "${workflow}" 'config --quiet' "safe Compose credential gate"
assert_contains "${workflow}" 'validate_redis_password' "Redis ACL password format preflight"
assert_contains "${workflow}" 'Redis ACL passwords must be distinct' "Redis ACL password distinctness preflight"
assert_contains "${workflow}" 'REDISCLI_AUTH=' "authenticated Redis command"
assert_contains "${workflow}" 'redis-cli --raw --user admin ping' "authenticated Redis PING"
assert_contains "${workflow}" 'http://127.0.0.1:8000/api/v1/health' "local FastAPI health check"
assert_contains "${workflow}" 'http://127.0.0.1:8080/api/v1/health/ready' "local Spring readiness check"
assert_contains "${workflow}" 'XINFO GROUPS meeting-analysis' "meeting-analysis group readiness check"
assert_contains "${workflow}" 'meeting-analysis-workers' "expected queue consumer group"
assert_contains "${workflow}" 'https://${{ secrets.OCI_DOMAIN }}/api/v1/health/ready' "public Spring health check"
assert_contains "${app_dir}/backend_spring/src/main/java/com/workflowai/security/SecurityConfig.java" \
  '"/api/v1/health/**"' "unauthenticated readiness/liveness matcher"
assert_contains "${workflow}" 'XLEN meeting-analysis' "rollback queue length metric"
assert_contains "${workflow}" 'XPENDING meeting-analysis meeting-analysis-workers' "rollback pending metric"
assert_contains "${workflow}" '이전 코드는 Redis Stream을 drain할 수 없습니다' "rollback queue warning"
assert_contains "${workflow}" '^[0-9]+$' "numeric rollback metric validation"
assert_contains "${workflow}" '[ "$queue_length" -ne 0 ]' "nonzero queue length rollback gate"
assert_contains "${workflow}" '[ "$queue_pending" -ne 0 ]' "nonzero pending rollback gate"
assert_contains "${workflow}" 'SELECT source_type FROM rag_assignee_sync_failures' "RAG outbox rollback metric"
assert_contains "${workflow}" '[ "$rag_outbox_count" -ne 0 ]' "nonzero RAG outbox rollback gate"
assert_contains "${workflow}" 'Automatic rollback blocked' "fail-closed rollback message"
assert_contains "${workflow}" 'manual drain/compensation required' "manual recovery requirement"
assert_contains "${workflow}" 'docker stop --time 60 workflow-backend-spring' "rollback Spring quiesce"
config_line=$(grep -nF 'config --quiet' "${workflow}" | head -n 1 | cut -d: -f1)
password_preflight_line=$(grep -nF 'validate_redis_password' "${workflow}" | head -n 1 | cut -d: -f1)
up_line=$(grep -nF 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build' \
  "${workflow}" | head -n 1 | cut -d: -f1)
readiness_loop_line=$(grep -nF 'for attempt in $(seq 1 30)' "${workflow}" | head -n 1 | cut -d: -f1)
readiness_end_line=$(grep -nF 'if [ "$internal_ready" -ne 1 ]' "${workflow}" | head -n 1 | cut -d: -f1)
rollback_length_line=$(grep -nF 'queue_length=$(docker exec workflow-redis' "${workflow}" | cut -d: -f1)
rollback_pending_line=$(grep -nF 'queue_pending=$(docker exec workflow-redis' "${workflow}" | cut -d: -f1)
rollback_outbox_line=$(grep -nF 'SELECT source_type FROM rag_assignee_sync_failures' "${workflow}" | cut -d: -f1)
rollback_stop_line=$(grep -nF 'docker stop --time 60 workflow-backend-spring' "${workflow}" | cut -d: -f1)
rollback_numeric_gate_line=$(grep -nF '^[0-9]+$' "${workflow}" | head -n 1 | cut -d: -f1)
rollback_zero_gate_line=$(grep -nF '[ "$queue_length" -ne 0 ]' "${workflow}" | head -n 1 | cut -d: -f1)
# 롤백 대상이 deploy-previous 에서 deploy-last-good 으로 바뀌었는데(직전 배포본은 정상
# 동작이 확인된 적이 없다는 이유, deploy-oci.yml 주석 참고) 이 줄은 따라가지 않아
# 스크립트가 여기서 죽어 있었다. 아래 순서 검사들이 통째로 도달하지 못했다는 뜻이다.
rollback_reset_line=$(grep -nF 'git reset --hard "$rollback_target"' "${workflow}" | cut -d: -f1)
test "${config_line}" -lt "${up_line}"
test "${password_preflight_line}" -lt "${config_line}"
for readiness_command in 'redis-cli --raw --user admin ping' \
  'http://127.0.0.1:8000/api/v1/health' 'http://127.0.0.1:8080/api/v1/health/ready' \
  'XINFO GROUPS meeting-analysis'; do
  command_line=$(grep -nF "${readiness_command}" "${workflow}" | head -n 1 | cut -d: -f1)
  test "${command_line}" -gt "${readiness_loop_line}"
  test "${command_line}" -lt "${readiness_end_line}"
done
test "${rollback_stop_line}" -lt "${rollback_length_line}"
test "${rollback_length_line}" -lt "${rollback_pending_line}"
test "${rollback_pending_line}" -lt "${rollback_outbox_line}"
test "${rollback_outbox_line}" -lt "${rollback_numeric_gate_line}"
test "${rollback_numeric_gate_line}" -lt "${rollback_zero_gate_line}"
test "${rollback_zero_gate_line}" -lt "${rollback_reset_line}"
if grep -Eq '(^|[[:space:]])(source[[:space:]]+|\.[[:space:]]+\.\/\.env|set[[:space:]]+-a)' "${workflow}"; then
  printf '%s\n' "deploy workflow must not execute Compose dotenv as shell code" >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])set[[:space:]]+-x([[:space:]]|$)' "${workflow}"; then
  printf '%s\n' "deploy workflow must never enable shell tracing" >&2
  exit 1
fi

for port in 5432 6379 9092 8000 8080; do
  assert_contains "${runbook}" "${port}" "external closure check for port ${port}"
done
for credential in HF_TOKEN HUGGINGFACEHUB_API_TOKEN LANGSMITH_API_KEY GOOGLE_CLIENT_SECRET \
  RAG_INTERNAL_API_KEY POSTGRES_PASSWORD SPRING_DATASOURCE_PASSWORD DATABASE_URL; do
  assert_contains "${runbook}" "${credential}" "mandatory credential rotation for ${credential}"
done
for scenario in 'default_denied=' 'spring_denied=' 'fastapi_denied=' 'pending_after=' \
  'test "$pending_after" = 0' 'before_length=' 'after_length=' \
  'test "$after_length" = "$before_length"' 'test "$after_pending" = "$before_pending"' \
  'stop backend-spring' 'spring_ready=0' 'redis_ready=0'; do
  assert_contains "${runbook}" "${scenario}" "executable OCI verification ${scenario}"
done
if grep -Eq '^(HF_TOKEN|HUGGINGFACEHUB_API_TOKEN|LANGSMITH_API_KEY|GOOGLE_CLIENT_SECRET|RAG_INTERNAL_API_KEY|POSTGRES_PASSWORD|SPRING_DATASOURCE_PASSWORD)=[^<[:space:]]' "${runbook}"; then
  printf '%s\n' "runbook must not contain credential values" >&2
  exit 1
fi
for scenario in "appendonly" "ACL" "pending 복구" "force-recreate redis" "FAILED" \
  "meeting_analysis:" "rag_answer:" "payload" "로그" "BGREWRITEAOF" \
  "aof_last_bgrewrite_status" "암호화" "접근 권한" "보존 기간" \
  "unavailable" "manual drain/compensation" "aof_rewrite_scheduled:0" \
  "docker stop --time 60 workflow-backend-spring" "docker stop workflow-frontend" \
  "docker start workflow-backend-spring" 'drain_complete=0' 'final_length=' \
  'test "$final_length" = 0' "docker start workflow-frontend" "수동 XACK/XDEL 금지"; do
  assert_contains "${runbook}" "${scenario}" "OCI Redis verification scenario ${scenario}"
done

assert_contains "${troubleshooting}" 'REDISCLI_AUTH=' "secret-safe Redis authentication"
assert_contains "${troubleshooting}" 'XLEN meeting-analysis' "queue length diagnosis"
assert_contains "${troubleshooting}" 'XPENDING meeting-analysis meeting-analysis-workers' "pending diagnosis"
assert_contains "${troubleshooting}" 'XINFO GROUPS meeting-analysis' "consumer group diagnosis"
assert_contains "${troubleshooting}" '이전 코드는 Redis Stream과 새 RAG outbox를 처리할 수 없습니다' \
  "rollback recovery caution"
for scenario in "BGREWRITEAOF" "aof_last_bgrewrite_status" "암호화" "접근 권한" \
  "보존 기간" "unavailable" "manual drain/compensation" "payload 조회 금지" \
  "aof_rewrite_scheduled:0" "docker stop --time 60 workflow-backend-spring" \
  "docker stop workflow-frontend" "docker start workflow-backend-spring" \
  'drain_complete=0' 'final_length=' 'test "$final_length" = 0' \
  "docker start workflow-frontend" "수동 XACK/XDEL 금지"; do
  assert_contains "${troubleshooting}" "${scenario}" "fail-closed Redis recovery ${scenario}"
done
for recovery_doc in "${runbook}" "${troubleshooting}"; do
  ingress_stop_line=$(grep -nF 'docker stop workflow-frontend' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  drain_start_line=$(grep -nF 'docker start workflow-backend-spring' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  drain_monitor_line=$(grep -nF 'drain_complete=0' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  final_stop_line=$(grep -nF 'docker stop --time 60 workflow-backend-spring' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  final_metric_line=$(grep -nF 'final_length=' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  frontend_start_line=$(grep -nF 'docker start workflow-frontend' "${recovery_doc}" | tail -n 1 | cut -d: -f1)
  test "${ingress_stop_line}" -lt "${drain_start_line}"
  test "${drain_start_line}" -lt "${drain_monitor_line}"
  test "${drain_monitor_line}" -lt "${final_stop_line}"
  test "${final_stop_line}" -lt "${final_metric_line}"
  test "${final_metric_line}" -lt "${frontend_start_line}"
done
if grep -Eq '(^|[[:space:]])set[[:space:]]+-x([[:space:]]|$)' "${troubleshooting}"; then
  printf '%s\n' "troubleshooting commands must never enable shell tracing" >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])(source[[:space:]]+|\.[[:space:]]+\.\/\.env|set[[:space:]]+-a)' "${troubleshooting}"; then
  printf '%s\n' "troubleshooting must not execute Compose dotenv as shell code" >&2
  exit 1
fi
assert_contains "${troubleshooting}" 'spring_ready=0' "bounded Spring recovery readiness"
assert_contains "${troubleshooting}" 'test "$spring_ready" = 1' "Spring recovery failure gate"

if [ "${smoke_mode}" = "1" ]; then
  if ! docker info >/dev/null 2>&1; then
    printf '%s\n' "Redis runtime smoke required, but Docker is unavailable" >&2
    exit 1
  fi
  if ! docker image inspect redis:7-alpine >/dev/null 2>&1; then
    printf '%s\n' "Redis runtime smoke required, but redis:7-alpine is unavailable" >&2
    exit 1
  fi
fi

if [ "${smoke_mode}" != "0" ] \
  && docker info >/dev/null 2>&1 \
  && docker image inspect redis:7-alpine >/dev/null 2>&1; then
  smoke_started=1
  docker compose \
    --project-name "${project_name}" \
    --env-file "${tmp_dir}/compose.env" \
    -f "${app_dir}/docker-compose.yml" \
    -f "${app_dir}/docker-compose.prod.yml" \
    -f "${smoke_override}" \
    up -d redis >"${tmp_dir}/smoke.log" 2>&1

  for _ in $(seq 1 30); do
    if docker compose \
      --project-name "${project_name}" \
      --env-file "${tmp_dir}/compose.env" \
      -f "${app_dir}/docker-compose.yml" \
      -f "${app_dir}/docker-compose.prod.yml" \
      -f "${smoke_override}" \
      exec -T redis sh -c \
      'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --user admin ping' \
      >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  docker compose \
    --project-name "${project_name}" \
    --env-file "${tmp_dir}/compose.env" \
    -f "${app_dir}/docker-compose.yml" \
    -f "${app_dir}/docker-compose.prod.yml" \
    -f "${smoke_override}" \
    exec -T redis sh -ec '
      admin() {
        REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin "$@"
      }
      spring() {
        REDISCLI_AUTH="$REDIS_SPRING_PASSWORD" redis-cli --raw --user spring "$@"
      }
      fastapi() {
        REDISCLI_AUTH="$REDIS_FASTAPI_PASSWORD" redis-cli --raw --user fastapi "$@"
      }

      [ "$(admin ping)" = "PONG" ]
      [ "$(stat -c %a /run/workflow-redis/users.acl)" = "600" ]
      [ "$(admin config get appendonly | tail -n 1)" = "yes" ]
      [ "$(admin config get appendfsync | tail -n 1)" = "everysec" ]
      [ "$(admin config get maxmemory-policy | tail -n 1)" = "noeviction" ]
      [ "$(admin config get maxmemory | tail -n 1)" = "67108864" ]
      [ "$(admin config get auto-aof-rewrite-percentage | tail -n 1)" = "50" ]
      [ "$(admin config get auto-aof-rewrite-min-size | tail -n 1)" = "16777216" ]

      default_denied="$(redis-cli --raw ping 2>&1 || true)"
      case "$default_denied" in
        *NOAUTH*) ;;
        *) exit 1 ;;
      esac

      spring client setname workflow-queue-smoke >/dev/null
      redis_version="$(admin info server | sed -n "s/^redis_version:\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2/p")"
      redis_major="${redis_version%% *}"
      redis_minor="${redis_version#* }"
      if [ "$redis_major" -gt 7 ] || { [ "$redis_major" -eq 7 ] && [ "$redis_minor" -ge 2 ]; }; then
        spring client setinfo lib-name workflow-queue-smoke >/dev/null
      fi

      stream=meeting-analysis
      group=meeting-analysis-workers-smoke
      consumer=meeting-analysis-worker-smoke
      ack_script="
        if not redis.acl_check_cmd(\"XACK\", KEYS[1], ARGV[1], ARGV[2]) then
          return redis.error_reply(\"XACK permission denied\")
        end
        if not redis.acl_check_cmd(\"XDEL\", KEYS[1], ARGV[2]) then
          return redis.error_reply(\"XDEL permission denied\")
        end
        redis.call(\"XACK\", KEYS[1], ARGV[1], ARGV[2])
        return redis.call(\"XDEL\", KEYS[1], ARGV[2])
      "
      publisher_script="$(cat /run/workflow-redis/meeting-analysis-enqueue.lua)"
      publisher_stream=meeting-analysis
      publisher_eval="$(spring eval "$publisher_script" 1 "$publisher_stream" 2 fixture-eval)"
      case "$publisher_eval" in
        [0-9]*-[0-9]*) ;;
        *) exit 1 ;;
      esac
      [ "$(spring xlen "$publisher_stream")" = "1" ]
      publisher_sha="$(admin script load "$publisher_script")"
      publisher_evalsha="$(spring evalsha "$publisher_sha" 1 "$publisher_stream" 2 fixture-evalsha)"
      case "$publisher_evalsha" in
        [0-9]*-[0-9]*) ;;
        *) exit 1 ;;
      esac
      [ "$(spring xlen "$publisher_stream")" = "2" ]
      [ "$(spring eval "$publisher_script" 1 "$publisher_stream" 2 fixture-full-eval)" = "QUEUE_FULL" ]
      [ "$(spring xlen "$publisher_stream")" = "2" ]
      [ "$(spring evalsha "$publisher_sha" 1 "$publisher_stream" 2 fixture-full-evalsha)" = "QUEUE_FULL" ]
      [ "$(spring xlen "$publisher_stream")" = "2" ]
      admin del "$publisher_stream" >/dev/null

      first_id="$(spring xadd "$stream" "*" payload fixture-one)"
      spring xgroup create "$stream" "$group" 0 >/dev/null
      spring xreadgroup group "$group" "$consumer" count 1 streams "$stream" ">" >/dev/null
      [ -n "$(admin xpending "$stream" "$group" - + 10)" ]
      [ -n "$(spring xpending "$stream" "$group" - + 10)" ]
      spring xclaim "$stream" "$group" recovery-worker 0 "$first_id" >/dev/null
      [ "$(spring eval "$ack_script" 1 "$stream" "$group" "$first_id")" = "1" ]
      [ "$(admin xlen "$stream")" = "0" ]
      [ -z "$(admin xpending "$stream" "$group" - + 10)" ]

      second_id="$(spring xadd "$stream" "*" payload fixture-two)"
      spring xreadgroup group "$group" "$consumer" count 1 streams "$stream" ">" >/dev/null
      [ -n "$(admin xpending "$stream" "$group" - + 10)" ]
      script_sha="$(admin script load "$ack_script")"
      [ "$(spring evalsha "$script_sha" 1 "$stream" "$group" "$second_id")" = "1" ]
      [ "$(admin xlen "$stream")" = "0" ]
      [ -z "$(admin xpending "$stream" "$group" - + 10)" ]
      xgroup_destroy_denied="$(spring xgroup destroy "$stream" "$group" 2>&1 || true)"
      case "$xgroup_destroy_denied" in
        *NOPERM*) ;;
        *) exit 1 ;;
      esac

      spring_denied="$(spring set meeting_analysis:forbidden fixture 2>&1 || true)"
      case "$spring_denied" in
        *NOPERM*) ;;
        *) exit 1 ;;
      esac
      [ "$(admin exists meeting_analysis:forbidden)" = "0" ]
      spring_stream_denied="$(spring xadd meeting-analysis:forbidden "*" payload fixture 2>&1 || true)"
      case "$spring_stream_denied" in
        *NOPERM*) ;;
        *) exit 1 ;;
      esac
      [ "$(admin exists meeting-analysis:forbidden)" = "0" ]

      fastapi set meeting_analysis:acl-smoke fixture >/dev/null
      [ "$(fastapi get meeting_analysis:acl-smoke)" = "fixture" ]
      fastapi set rag_answer:acl-smoke fixture >/dev/null
      [ "$(fastapi get rag_answer:acl-smoke)" = "fixture" ]
      [ "$(fastapi incr rag_epoch:acl-smoke)" = "1" ]
      fastapi del meeting_analysis:acl-smoke rag_answer:acl-smoke >/dev/null
      fastapi_epoch_delete_denied="$(fastapi del rag_epoch:acl-smoke 2>&1 || true)"
      case "$fastapi_epoch_delete_denied" in
        *NOPERM*) ;;
        *) exit 1 ;;
      esac
      [ "$(admin get rag_epoch:acl-smoke)" = "1" ]

      fastapi_denied="$(fastapi xadd meeting-analysis:forbidden "*" payload fixture 2>&1 || true)"
      case "$fastapi_denied" in
        *NOPERM*) ;;
        *) exit 1 ;;
      esac
      [ "$(admin exists meeting-analysis:forbidden)" = "0" ]
    '
  smoke_completed=1
fi

printf '%s\n' "Redis Compose static security checks passed"
if [ "${smoke_completed}" -eq 1 ]; then
  printf '%s\n' "Redis runtime ACL/AOF smoke passed"
elif [ "${smoke_mode}" = "auto" ]; then
  printf '%s\n' "Redis runtime ACL/AOF smoke skipped (Docker or image unavailable)"
else
  printf '%s\n' "Redis runtime ACL/AOF smoke disabled"
fi
