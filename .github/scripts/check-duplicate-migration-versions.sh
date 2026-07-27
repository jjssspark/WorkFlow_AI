#!/usr/bin/env bash
# 같은 버전 번호를 가진 Flyway V파일이 둘 이상인지 검사한다.
#
# 왜 필요한가: 버전 중복은 파일 하나만 봐서는 알 수 없고 다른 파일과의 조합에서만
# 드러난다. 서로 다른 두 PR이 같은 번호를 잡으면 각각은 통과하고, 합쳐진 뒤에야
# 터진다(2026-07-27, V20260726_1 두 개). Flyway는 이 상태를 DB에 붙기도 전에 파일
# 해석 단계에서 거부하므로 Spring이 기동하지 못하고, 뒤에 줄 선 마이그레이션까지
# 함께 막힌다.
#
# 그래서 diff가 아니라 트리 전체를 본다. 두 곳에서 호출한다.
#   - migration-guard: PR 시점과 dev/main push 직후 (알림)
#   - deploy-oci 의 test 잡: 배포가 의존하는 게이트 (차단)
set -euo pipefail

migration_dir=${1:-'App/backend_spring/src/main/resources/db/migration'}

# Flyway 의 버전 파싱 규칙을 그대로 따른다 (flyway 11.7.2 로 실측 확인, 2026-07-27).
#   V20260726_1__desc.sql -> 20260726.1   ('_' 는 '.' 와 같다)
#   자릿수 앞의 0은 무시된다 (V1_01 == V1_1). 각 자리를 정수로 비교하기 때문.
#   R__desc.sql (반복 실행) 은 버전이 없으므로 대상이 아니다.
normalize_version() {
  printf '%s' "$1" | tr '_' '.' | awk -F. '{
    o = ""
    for (i = 1; i <= NF; i++) {
      p = $i
      sub(/^0+/, "", p)
      if (p == "") p = "0"
      o = (i == 1 ? p : o "." p)
    }
    print o
  }'
}

versions=$(
  for f in "$migration_dir"/V*.sql; do
    [ -e "$f" ] || continue
    base=${f##*/}
    raw=${base#V}
    raw=${raw%%__*}
    printf '%s\t%s\n' "$(normalize_version "$raw")" "$base"
  done
)

if [ -z "$versions" ]; then
  echo '버전 있는 마이그레이션 파일 없음 — 통과.'
  exit 0
fi

dupes=$(printf '%s\n' "$versions" | cut -f1 | sort | uniq -d)

if [ -n "$dupes" ]; then
  echo '::error::같은 버전 번호를 가진 마이그레이션이 둘 이상 있습니다.'
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    echo "  버전 $v"
    printf '%s\n' "$versions" | awk -F'\t' -v v="$v" '$1 == v { print "    - " $2 }'
  done <<< "$dupes"
  echo
  echo 'Flyway 는 이 상태를 DB 에 붙기도 전에 파일 해석 단계에서 거부합니다.'
  echo '그대로 배포하면 Spring 이 기동하지 못하고, 뒤에 줄 선 마이그레이션까지 함께 막힙니다.'
  echo '아직 적용되지 않은 쪽의 번호를 비어 있는 번호로 바꾸세요.'
  exit 1
fi

count=$(printf '%s\n' "$versions" | wc -l | tr -d ' ')
echo "버전 중복 없음 — 마이그레이션 ${count}개 확인."
