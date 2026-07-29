#!/usr/bin/env bash
set -euo pipefail

# check-migration-changes.sh 자체를 검증한다. 별도 테스트 프레임워크 없이, 임시 git
# 저장소에서 실제 rename 커밋을 재현해 승인 목록/차단 동작이 의도대로 동작하는지 확인한다.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/check-migration-changes.sh"
migration_dir='App/backend_spring/src/main/resources/db/migration'

tmp_repo=$(mktemp -d)
trap 'rm -rf "$tmp_repo"' EXIT

cd "$tmp_repo"
git init -q
git config user.email "test@example.com"
git config user.name "Test"

mkdir -p "$migration_dir"
echo "select 1;" > "$migration_dir/V20260726_1__rag_assignee_sync_failures.sql"
echo "select 1;" > "$migration_dir/V20260726_2__task_done_date.sql"
echo "select 1;" > "$migration_dir/V20260726_3__user_profile_and_agreements.sql"
# 내용을 다르게 둔다. 4개 파일이 모두 같은 내용이면 git이 exact rename 짝을 다른
# 조합으로 맺을 수 있어(내용이 같아 구분 불가) 승인 목록과 어긋난 쌍이 나올 수 있다.
echo "delete from notifications where project_id is null;" > "$migration_dir/V20260728_2__notifications_delete_orphaned_null_project_id.sql"
git add "$migration_dir"
git commit -q -m "base: 초기 마이그레이션 파일"
base_sha=$(git rev-parse HEAD)

# 시나리오 1: 승인된 rename만 있는 커밋 -> 통과해야 한다.
git mv "$migration_dir/V20260726_1__rag_assignee_sync_failures.sql" "$migration_dir/V20260727_1__rag_assignee_sync_failures.sql"
git mv "$migration_dir/V20260726_2__task_done_date.sql" "$migration_dir/V20260727_2__task_done_date.sql"
git mv "$migration_dir/V20260726_3__user_profile_and_agreements.sql" "$migration_dir/V20260727_3__user_profile_and_agreements.sql"
git mv "$migration_dir/V20260728_2__notifications_delete_orphaned_null_project_id.sql" "$migration_dir/V20260728_3__notifications_delete_orphaned_null_project_id.sql"
git commit -q -am "rename: 승인된 4건"
approved_head=$(git rev-parse HEAD)

if ! bash "$script" "$base_sha" "$approved_head" >/dev/null 2>&1; then
  echo "FAIL: 승인된 rename 시나리오가 차단되었습니다." >&2
  exit 1
fi
echo "PASS: 승인된 rename은 통과한다."

# 시나리오 2: 승인 목록에 없는 임의의 rename -> base에 guard workflow가 없어도 차단되어야
# 한다 (이 임시 저장소에는 .github/workflows/migration-guard.yml 자체가 없으므로,
# "base에 guard가 없으면 rename을 통째로 허용"하던 예전 우회 경로가 남아있는지도 함께 검증한다).
git checkout -q -b unapproved "$base_sha"
git mv "$migration_dir/V20260726_1__rag_assignee_sync_failures.sql" "$migration_dir/V20260728_1__rag_assignee_sync_failures.sql"
git commit -q -am "rename: 승인되지 않은 임의 rename"
unapproved_head=$(git rev-parse HEAD)

if bash "$script" "$base_sha" "$unapproved_head" >/dev/null 2>&1; then
  echo "FAIL: 승인되지 않은 rename이 통과했습니다 (guard workflow가 base에 없을 때의 정책 우회 가능성)." >&2
  exit 1
fi
echo "PASS: 승인되지 않은 rename은 base에 guard workflow가 없어도 차단된다."

# 시나리오 3: 기존 V파일에 대한 순수 수정(내용 변경) -> 차단되어야 한다.
git checkout -q -b modified "$base_sha"
echo "select 2;" > "$migration_dir/V20260726_1__rag_assignee_sync_failures.sql"
git commit -q -am "modify: 이미 적용된 V파일 내용 수정"
modified_head=$(git rev-parse HEAD)

if bash "$script" "$base_sha" "$modified_head" >/dev/null 2>&1; then
  echo "FAIL: 이미 적용된 V파일 수정이 통과했습니다." >&2
  exit 1
fi
echo "PASS: 이미 적용된 V파일 수정은 차단된다."

echo "모든 시나리오 통과."
