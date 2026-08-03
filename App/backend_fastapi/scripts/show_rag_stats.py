#!/usr/bin/env python3
"""어시스턴트 질의 집계를 읽어 비율까지 계산해 보여준다.

## 왜 이 스크립트가 있는가

읽는 방법을 같이 만들지 않으면 관측은 죽은 데이터가 된다. `assistant_messages` 테이블이
"AI Assistant 대화 이력"으로 정의됐지만 아무도 읽지 않아 2026-07-29에 삭제됐다.
같은 실패를 반복하지 않기 위해 수집과 같은 커밋에 읽기를 넣는다.

HGETALL 로 하루씩 볼 수도 있지만, 판단에 필요한 건 며칠치 합계와 **비율**이다
(예: "코드가 든 질문이 몇 %인가"). 원시 카운트만 보고 비율을 암산하면 틀린다.

## 쓰는 법

FastAPI 컨테이너 안에서 그대로 돌린다. 컨테이너에 이미 REDIS_URL 과 fastapi 계정
자격 증명이 있어 추가로 넘길 것이 없다.

    docker exec workflow-backend-fastapi python scripts/show_rag_stats.py --days 14

admin 계정을 쓰지 않는 이유: admin 비밀번호는 redis 컨테이너에만 있다. 읽기를 admin 으로만
열어두면 비밀번호를 한 벌 더 실어 날라야 하므로, ACL 에 fastapi 의 +hgetall 을 열었다
(자기가 쓴 집계 카운터를 자기가 읽는 것이고, 숫자만 들어 있다).

하루치만 눈으로 볼 때는 스크립트 없이도 된다.

    docker exec workflow-redis sh -c \
      'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --user admin HGETALL rag_stats:2026-08-15'

날짜는 **UTC 기준**이다(rag_stats._stats_key 와 같은 기준). KST 와 9시간 차이가 나므로
"오늘"의 경계가 한국 시각 자정이 아니라 오전 9시다.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

# 이 스크립트는 backend_fastapi 를 작업 디렉터리로 두고 실행한다(컨테이너 WORKDIR 과 동일).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from redis import Redis  # noqa: E402

# 관심 순서대로 나열한다. 여기 없는 필드(proj_* 등)는 아래에서 따로 묶어 보여준다.
_CODE_BUCKETS = ("codes_0", "codes_1", "codes_2", "codes_3", "codes_4", "codes_5plus")
_FLAGS = ("personal", "codes_truncated", "code_miss", "ids_referenced", "id_miss", "sources_short")

# 분모가 total 이 아니라 라우팅 대상(개인화 제외)인 플래그. 개인화 질문에는 라우팅을
# 걸지 않으므로 total 로 나누면 비율이 실제보다 낮게 보인다.
_ROUTED_BASE_FLAGS = ("codes_truncated", "code_miss", "ids_referenced", "id_miss")


def _connect() -> Redis:
    """컨테이너에 이미 있는 자격 증명을 그대로 쓴다. 새 환경변수를 만들지 않는다."""
    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    username = os.getenv("REDIS_USERNAME")
    password = os.getenv("REDIS_PASSWORD")
    if username and not password:
        # ACL 이 켜진 환경에서 비밀번호 없이 붙으면 NOAUTH 로 죽는다. 어디를 봐야 하는지
        # 알려주지 않으면 "스크립트가 고장났다"로 읽히므로 여기서 끊는다.
        raise SystemExit("REDIS_PASSWORD 가 없습니다. FastAPI 컨테이너 안에서 실행하세요.")
    return Redis.from_url(url, username=username, password=password, decode_responses=True)


def _collect(client: Redis, days: int) -> tuple[Counter, list[str]]:
    today = datetime.now(timezone.utc).date()
    totals: Counter = Counter()
    seen_days: list[str] = []
    for offset in range(days):
        stamp = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        raw = client.hgetall(f"rag_stats:{stamp}")
        if not raw:
            continue
        seen_days.append(stamp)
        for field, value in raw.items():
            totals[field] += int(value)
    return totals, sorted(seen_days)


def _percent(count: int, total: int) -> str:
    if total == 0:
        return "  -  "
    return f"{count / total * 100:5.1f}%"


def _render(totals: Counter, seen_days: list[str], days: int) -> str:
    total = totals.get("total", 0)
    if total == 0:
        return f"최근 {days}일(UTC)에 기록된 질의가 없습니다."

    lines = [
        f"기간: 최근 {days}일(UTC) 중 데이터가 있는 {len(seen_days)}일 "
        f"({seen_days[0]} ~ {seen_days[-1]})",
        f"질의 총계: {total}건",
        "",
        "코드 개수 분포 (개인화 질문 제외)",
    ]
    routed = sum(totals.get(bucket, 0) for bucket in _CODE_BUCKETS)
    for bucket in _CODE_BUCKETS:
        count = totals.get(bucket, 0)
        label = bucket.replace("codes_", "코드 ").replace("5plus", "5개 이상")
        lines.append(f"  {label:<12} {count:>6}  {_percent(count, routed)}")
    # 코드가 하나라도 든 질문의 비중 - 라우팅의 체감 효과를 가늠하는 첫 번째 값이다.
    with_codes = routed - totals.get("codes_0", 0)
    lines.append(f"  {'코드 있음':<12} {with_codes:>6}  {_percent(with_codes, routed)}  <- 라우팅 대상")

    lines += ["", "플래그"]
    for flag in _FLAGS:
        count = totals.get(flag, 0)
        base = routed if flag in _ROUTED_BASE_FLAGS else total
        lines.append(f"  {flag:<16} {count:>6}  {_percent(count, base)}")

    projects = sorted(
        ((name[5:], value) for name, value in totals.items() if name.startswith("proj_")),
        key=lambda item: item[1],
        reverse=True,
    )
    if projects:
        lines += ["", "프로젝트 분포"]
        for project_id, count in projects:
            # project 1 은 테스트 주입 데이터가 섞인 데모다. 여기 비중이 높으면 위 비율을
            # 실사용으로 읽으면 안 된다.
            note = "  (데모)" if project_id == "1" else ""
            lines.append(f"  project {project_id:<8} {count:>6}  {_percent(count, total)}{note}")

    unknown = sorted(
        name
        for name in totals
        if name not in _FLAGS
        and name not in _CODE_BUCKETS
        and name != "total"
        and not name.startswith("proj_")
    )
    if unknown:
        # 코드가 새 필드를 쓰기 시작했는데 이 스크립트를 안 고친 경우다. 조용히 버리면
        # 새로 만든 관측이 또 안 보이게 된다.
        lines += ["", f"이 스크립트가 모르는 필드: {', '.join(unknown)}"]

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=14, help="거슬러 볼 일수 (기본 14, UTC 기준)")
    args = parser.parse_args()

    if args.days < 1:
        raise SystemExit("--days 는 1 이상이어야 합니다.")

    totals, seen_days = _collect(_connect(), args.days)
    print(_render(totals, seen_days, args.days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
