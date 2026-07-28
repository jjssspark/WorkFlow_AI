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
# 2026-07-28: 서로 다른 PR이 각각 V20260728_2를 잡아 다시 같은 충돌이 생겼다
# (11:38 삭제 마이그레이션, 12:02 백필 마이그레이션). 삭제 쪽을 _3으로 미뤄 해소한다.
# 백필이 구제하도록 만든 행(target_type='project' + target_id IS NOT NULL)을 삭제가
# 먼저 지워버리지 않도록 순서를 백필 → 삭제로 두는 쪽이 맞다.
#
# "아직 적용되지 않았음"을 아래로 확인했으므로 체크섬 위험이 없다.
#   - 배포는 main push 트리거뿐이고 origin/main에는 V20260728_1만 있다.
#   - 두 파일이 함께 있는 dev는 Flyway가 파일 해석 단계에서 거부하므로 적용 자체가 불가능하다.
#   - 두 SQL 모두 조건부 DML이라 재실행해도 같은 상태로 수렴한다.
approved_renames=(
  "R100	$migration_dir/V20260726_1__rag_assignee_sync_failures.sql	$migration_dir/V20260727_1__rag_assignee_sync_failures.sql"
  "R100	$migration_dir/V20260726_2__task_done_date.sql	$migration_dir/V20260727_2__task_done_date.sql"
  "R100	$migration_dir/V20260726_3__user_profile_and_agreements.sql	$migration_dir/V20260727_3__user_profile_and_agreements.sql"
  "R100	$migration_dir/V20260728_2__notifications_delete_orphaned_null_project_id.sql	$migration_dir/V20260728_3__notifications_delete_orphaned_null_project_id.sql"
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
