#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

base_sha=$1
head_sha=$2
migration_dir='App/backend_spring/src/main/resources/db/migration'

changed=$(git diff --find-renames --name-status "$base_sha...$head_sha" -- "$migration_dir")

if [ -z "$changed" ]; then
  echo '마이그레이션 디렉터리 변경 없음.'
  exit 0
fi

printf '%s\n\n' "$changed"

allowed_status='^A[[:space:]]'

# dev와 fs3가 독립적으로 같은 버전 번호(V20260726_1/2/3)를 사용해 생긴 Flyway 충돌을
# 해소하기 위한 R100 rename 3건만 예외로 허용한다. base에 guard workflow가 있는지
# 여부와 무관하게 이 고정된 목록만 허용해, "guard 도입 이전 base면 rename을 통째로
# 허용" 같은 정책 우회 여지를 남기지 않는다. source 파일들은 이미 merge되어 더 이상
# base에 존재하지 않으므로 이 예외를 다시 악용할 수 없다.
approved_renames=(
  "R100	$migration_dir/V20260726_1__rag_assignee_sync_failures.sql	$migration_dir/V20260727_1__rag_assignee_sync_failures.sql"
  "R100	$migration_dir/V20260726_2__task_done_date.sql	$migration_dir/V20260727_2__task_done_date.sql"
  "R100	$migration_dir/V20260726_3__user_profile_and_agreements.sql	$migration_dir/V20260727_3__user_profile_and_agreements.sql"
)

is_approved_rename() {
  local candidate="$1" approved
  for approved in "${approved_renames[@]}"; do
    if [ "$candidate" = "$approved" ]; then
      return 0
    fi
  done
  return 1
}

violations=$(
  while IFS= read -r change; do
    if is_approved_rename "$change"; then
      echo '승인된 Flyway 버전 충돌 해소 rename 감지.' >&2
    elif ! printf '%s\n' "$change" | grep -Eq "$allowed_status"; then
      printf '%s\n' "$change"
    fi
  done <<< "$changed"
)

if [ -n "$violations" ]; then
  echo '::error::이미 적용된 마이그레이션 파일을 수정/삭제/이름변경할 수 없습니다.'
  printf '%s\n\n' "$violations"
  echo '변경이 필요하면 기존 파일을 고치지 말고 새 V파일을 추가하세요.'
  echo '예: V20260727_1__fix_evaluation_scores_public_flags.sql'
  exit 1
fi

echo '마이그레이션 변경 정책 검사 통과.'
