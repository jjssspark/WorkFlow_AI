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
