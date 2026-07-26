#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

base_sha=$1
head_sha=$2
migration_dir='App/backend_spring/src/main/resources/db/migration'
guard_workflow='.github/workflows/migration-guard.yml'

changed=$(git diff --find-renames --name-status "$base_sha...$head_sha" -- "$migration_dir")

if [ -z "$changed" ]; then
  echo '마이그레이션 디렉터리 변경 없음.'
  exit 0
fi

printf '%s\n\n' "$changed"

# migration-guard를 처음 추가한 PR에는 이미 계획된 Flyway 경로 재편(Rxxx)이 함께
# 포함돼 있었다. base에 guard가 없는 그 한 번만 rename을 허용한다. guard가 머지된
# 뒤의 모든 PR에서는 A(신규 파일) 외 상태를 차단하므로 기존 V파일 보호는 약해지지 않는다.
if git cat-file -e "$base_sha:$guard_workflow" 2>/dev/null; then
  allowed_status='^A[[:space:]]'
else
  echo 'migration-guard 최초 도입 PR: 기존 경로 재편 rename을 일회성으로 허용합니다.'
  allowed_status='^(A|R[0-9]{3})[[:space:]]'
fi

violations=$(printf '%s\n' "$changed" | grep -vE "$allowed_status" || true)

if [ -n "$violations" ]; then
  echo '::error::이미 적용된 마이그레이션 파일을 수정/삭제/이름변경할 수 없습니다.'
  printf '%s\n\n' "$violations"
  echo '변경이 필요하면 기존 파일을 고치지 말고 새 V파일을 추가하세요.'
  echo '예: V20260727_1__fix_evaluation_scores_public_flags.sql'
  exit 1
fi

echo '마이그레이션 변경 정책 검사 통과.'
