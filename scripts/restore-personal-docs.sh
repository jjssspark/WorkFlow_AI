#!/usr/bin/env bash
#
# document_<이름>/ 개인 문서 폴더를 git 히스토리에서 로컬로 되살린다.
#
# 배경:
#   개인 문서 폴더는 공유 레포에 올리지 않기로 하고 추적을 해제했다(.gitignore: document_*/).
#   git은 "경로 삭제"가 기록된 커밋을 pull하면 각자의 작업 트리에서도 그 파일을 지운다.
#   .gitignore는 추적 안 되는 파일에만 적용되므로 이 삭제를 막지 못한다.
#   파일 자체는 히스토리에 남아 있으므로 이 스크립트로 다시 꺼내온다.
#
# 왜 git checkout 이 아니라 git archive 인가:
#   `git checkout <ref> -- <path>` 는 파일을 복구하면서 인덱스에도 올려버린다.
#   그러면 ignore가 무력화되어 다음 커밋에 다시 딸려 올라간다.
#   `git archive` 는 인덱스를 건드리지 않고 파일만 풀어놓는다.
#
# 사용법:
#   bash scripts/restore-personal-docs.sh                    # 모든 document_* 폴더 복구
#   bash scripts/restore-personal-docs.sh document_이은주      # 특정 폴더만 복구
#   bash scripts/restore-personal-docs.sh --dry-run          # 무엇이 복구될지만 출력
#   bash scripts/restore-personal-docs.sh --force            # 기존 로컬 파일도 덮어쓰기
#
# 기본 동작은 비파괴적이다. 이미 로컬에 있는 파일은 건드리지 않고 없는 것만 채운다.

set -euo pipefail

DRY_RUN=0
FORCE=0
TARGETS=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -h|--help)
      sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "알 수 없는 옵션: $arg" >&2
      exit 2
      ;;
    *) TARGETS+=("$arg") ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "오류: git 저장소 안에서 실행하세요." >&2
  exit 1
}
cd "$ROOT"

# 개인 문서 폴더를 추적 해제한 커밋을 찾는다. 추적 해제 이후로는 이 경로에
# 삭제가 기록될 수 없으므로, 가장 최근의 삭제 커밋이 곧 그 커밋이다.
UNTRACK_COMMIT=$(git log --format=%H --diff-filter=D -1 -- 'document_*' || true)
if [ -z "$UNTRACK_COMMIT" ]; then
  echo "오류: document_* 를 추적 해제한 커밋을 히스토리에서 찾지 못했습니다." >&2
  echo "      아직 언트래킹 커밋이 push되지 않았다면 복구할 것이 없습니다." >&2
  exit 1
fi
BASE="${UNTRACK_COMMIT}^"

echo "복구 기준 커밋: $(git log -1 --format='%h %s' "$BASE")"

if [ ${#TARGETS[@]} -eq 0 ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && TARGETS+=("$line")
  done < <(git -c core.quotepath=false ls-tree --name-only "$BASE" | grep '^document_' || true)
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "복구 대상 폴더가 없습니다."
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

total_restored=0
total_skipped=0

for folder in "${TARGETS[@]}"; do
  folder="${folder%/}"

  if ! git cat-file -e "$BASE:$folder" 2>/dev/null; then
    echo "  건너뜀  $folder (기준 커밋에 없는 폴더)"
    continue
  fi

  rm -rf "${TMP:?}/extract"
  mkdir -p "$TMP/extract"
  git archive "$BASE" -- "$folder" | tar -x -C "$TMP/extract"

  restored=0
  skipped=0
  while IFS= read -r -d '' rel; do
    src="$TMP/extract/$rel"
    dest="$ROOT/$rel"
    if [ -e "$dest" ] && [ "$FORCE" -eq 0 ]; then
      skipped=$((skipped + 1))
      continue
    fi
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$(dirname "$dest")"
      cp -p "$src" "$dest"
    fi
    restored=$((restored + 1))
  done < <(cd "$TMP/extract" && find "$folder" -type f -print0)

  label=$([ "$DRY_RUN" -eq 1 ] && echo "복구 예정" || echo "복구")
  printf '  %-8s %-24s %3d개  (기존 유지 %d개)\n' "$label" "$folder" "$restored" "$skipped"
  total_restored=$((total_restored + restored))
  total_skipped=$((total_skipped + skipped))
done

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "드라이런: 복구 예정 ${total_restored}개 / 기존 유지 ${total_skipped}개. 실제 적용하려면 --dry-run 없이 다시 실행하세요."
  exit 0
fi

echo "복구 ${total_restored}개 / 기존 유지 ${total_skipped}개"

# ignore가 살아있는지 확인한다. 여기서 0이 아니면 파일이 다시 커밋에 딸려 올라간다.
tracked=$(git ls-files -- 'document_*' | wc -l | tr -d ' ')
if [ "$tracked" -ne 0 ]; then
  echo "경고: document_* 아래 ${tracked}개 파일이 다시 추적되고 있습니다. .gitignore를 확인하세요." >&2
  exit 1
fi
echo "확인: 추적 0건 — 복구된 파일은 커밋에 올라가지 않습니다."
