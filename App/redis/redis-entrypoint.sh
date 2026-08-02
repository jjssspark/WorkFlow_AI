#!/bin/sh
set -eu

validate_password() {
  variable_name="$1"
  value="$2"

  if [ "${#value}" -lt 32 ] || [ "${#value}" -gt 128 ]; then
    printf '%s\n' "${variable_name} must contain 32 to 128 characters" >&2
    exit 1
  fi

  case "${value}" in
    *[!A-Za-z0-9_-]*)
      printf '%s\n' "${variable_name} contains unsupported characters" >&2
      exit 1
      ;;
  esac
}

: "${REDIS_ADMIN_PASSWORD:?REDIS_ADMIN_PASSWORD is required}"
: "${REDIS_SPRING_PASSWORD:?REDIS_SPRING_PASSWORD is required}"
: "${REDIS_FASTAPI_PASSWORD:?REDIS_FASTAPI_PASSWORD is required}"

validate_password REDIS_ADMIN_PASSWORD "${REDIS_ADMIN_PASSWORD}"
validate_password REDIS_SPRING_PASSWORD "${REDIS_SPRING_PASSWORD}"
validate_password REDIS_FASTAPI_PASSWORD "${REDIS_FASTAPI_PASSWORD}"

if [ "${REDIS_ADMIN_PASSWORD}" = "${REDIS_SPRING_PASSWORD}" ] \
  || [ "${REDIS_ADMIN_PASSWORD}" = "${REDIS_FASTAPI_PASSWORD}" ] \
  || [ "${REDIS_SPRING_PASSWORD}" = "${REDIS_FASTAPI_PASSWORD}" ]; then
  printf '%s\n' "Redis ACL passwords must be distinct" >&2
  exit 1
fi

acl_dir=/run/workflow-redis
acl_file="${acl_dir}/users.acl"
acl_tmp="${acl_dir}/users.acl.tmp"
template=/usr/local/etc/redis/users.acl.template

# users.acl.template 안내
#
# 주의: ACL 파일은 주석(#)을 지원하지 않는다. 모든 줄이 user 키워드로 시작해야 하고,
# 아니면 redis-server가 "Aborting Redis startup because of ACL errors"로 기동을 중단한다
# (2026-07-30 실측). 빈 줄만 허용된다. 그래서 설명을 템플릿이 아니라 여기에 둔다.
#
# 원칙: 앱 계정은 자기가 실제로 쓰는 키와 명령만 갖는다. 코드에 새 키나 명령이 생기면
# 템플릿도 함께 고쳐야 한다 - 안 고치면 런타임에 NOPERM으로 조용히 실패한다.
#
# 선택자 `(~키패턴 +명령 ...)`은 키 묶음별로 권한을 나눈다. 루트 권한과 선택자는 OR로
# 평가된다. EVAL/EVALSHA는 스크립트가 선언한 KEYS에 대한 접근 권한이 필요하므로
# 스크립트를 실행하는 선택자 안에 함께 넣는다.
#
#   spring   ~meeting-analysis, ~dashboard-ai-jobs   작업 큐 (enqueue·ack Lua 포함)
#            ~dashboard-ai-inflight:*                중복 실행 방지 마커 (release/renew Lua)
#            ~dashboard-ai-done:*                    완료 표시 (set + exists)
#            ~assistant_thread:*                     어시스턴트 스레드 소유자
#            ~dashboard:workload-score:*             업무량 점수 캐시
#            Pub/Sub 미사용이므로 채널은 열지 않는다
#
#   fastapi  ~rag-jobs                               RAG 작업 큐 (enqueue Lua 포함)
#            &rag-result:*                           워커 -> 요청 스레드 결과 전달 채널
#            ~meeting_analysis:*, ~rag_answer:*      결과 캐시
#            ~rag_epoch:*                            캐시 무효화 카운터 (get + incr)
#            ~rag_stats:*                            질의 집계 카운터 (hincrby + expire + hgetall)
#
# rag_stats 에 +multi/+exec 가 없는 것은 의도적이다. 코드가 파이프라인을 transaction=False
# 로 열어 MULTI/EXEC 를 쓰지 않는다(rag_stats.record_question_query). 통계는 필드마다
# 독립적인 HINCRBY 라 원자성이 필요 없고, 권한은 실제로 쓰는 것만 준다.
#
# +hgetall 은 조회 스크립트(scripts/show_rag_stats.py)용이다. admin 비밀번호는 redis 컨테이너
# 에만 있어서, 읽기를 admin 으로만 열어두면 fastapi 컨테이너에서 스크립트를 돌릴 수 없다.
# 비밀번호를 한 벌 더 실어 나르는 것보다, 자기가 쓴 집계 카운터를 자기가 읽게 두는 편이 낫다
# (질문 원문이 아니라 숫자만 들어 있어 읽어도 얻을 정보가 없다).
#
# 2026-07-30: 코드가 쓰는 키의 절반이 빠져 있어 기능 두 개가 통째로 죽어 있던 것을 바로잡음.
#   - dashboard-ai-jobs 누락 -> DashboardAiQueueWorker가 기동마다 그룹 생성 실패
#   - rag-jobs / rag-result:* 누락 -> RAG 큐 xgroup|create가 NOPERM, 결과 Pub/Sub도 차단

umask 077
mkdir -p "${acl_dir}"
chmod 700 "${acl_dir}"

awk '
  {
    gsub(/__ADMIN_PASSWORD__/, ENVIRON["REDIS_ADMIN_PASSWORD"])
    gsub(/__SPRING_PASSWORD__/, ENVIRON["REDIS_SPRING_PASSWORD"])
    gsub(/__FASTAPI_PASSWORD__/, ENVIRON["REDIS_FASTAPI_PASSWORD"])
    print
  }
' "${template}" >"${acl_tmp}"

if grep -Eq '__[A-Z_]+PASSWORD__' "${acl_tmp}"; then
  printf '%s\n' "Redis ACL template contains an unresolved placeholder" >&2
  exit 1
fi

# redis-stack-server 이미지에는 redis 유저가 없고 redis-server가 root로 실행된다.
# aclfile을 root 소유 600으로 두면 root 프로세스가 그대로 읽는다.
# (alpine 시절의 `chown redis:redis`는 이 이미지에 없는 유저라 컨테이너를 크래시시켰다.)
chmod 600 "${acl_tmp}"
mv "${acl_tmp}" "${acl_file}"

# redis-stack-server에는 /usr/local/bin/docker-entrypoint.sh가 없다.
# compose command로 넘어온 redis-server 실행을 그대로 exec하고 aclfile만 덧붙인다.
# ($@ = "redis-server --loadmodule ... --dir /data", redis-server는 /usr/bin/redis-server)
exec "$@" --aclfile "${acl_file}"
