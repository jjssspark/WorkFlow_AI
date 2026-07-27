from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# RAG 검색은 유사도 상위 k개만 본다. "블로커 몇 건이야?" 같은 전수 집계 질문은 원리상
# 검색으로 답할 수 없다 - 12건이라는 값 자체가 컨텍스트에 들어오지 않는다. 그래서 프로젝트
# 전체를 한 번에 세어 프롬프트에 상시 주입한다. 블로커 기준은 대시보드와 같다
# (DashboardService.STATUS_BLOCKED = "blocked"). 기준이 갈리면 같은 화면에서 두 숫자가
# 어긋나 보인다.
#
# 매 질의에 붙는 비용이라 왕복 수를 늘리지 않는다 - 상태별·담당자별 집계와 마감 임박 건수를
# 쿼리 하나로 얻고 파이썬에서 접는다. 미배정 업무도 세야 해서 users는 LEFT JOIN이다.
#
# 담당자 묶음의 기준은 이름이 아니라 assignee_id다. 이름으로 묶으면 동명이인의 업무가 한 사람
# 것으로 합산되어 "누가 막혀 있나" 답이 틀린다. 이름은 표시용으로만 끌고 온다.
#
# 마감 임박은 오늘부터 _DUE_SOON_DAYS일간, 즉 [오늘, 오늘+7) 반열림 구간이다. BETWEEN을 쓰면
# 양 끝을 다 포함해 8일치가 세어져 상수 이름과 실제 범위가 어긋난다.
_DUE_SOON_DAYS = 7

_PROJECT_STATS_SQL = """
SELECT
    t.status      AS status,
    t.assignee_id AS assignee_id,
    u.name        AS assignee_name,
    COUNT(*) AS cnt,
    COUNT(*) FILTER (
        WHERE t.status <> 'done'
          AND t.due_date IS NOT NULL
          AND t.due_date >= CURRENT_DATE
          AND t.due_date < CURRENT_DATE + $2::int
    ) AS due_soon_cnt,
    COUNT(*) FILTER (
        WHERE t.status <> 'done'
          AND t.due_date IS NOT NULL
          AND t.due_date < CURRENT_DATE
    ) AS overdue_cnt
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1
GROUP BY t.status, t.assignee_id, u.name
"""

# 마감일은 청크 본문에 없어(실측: task 청크 131개 중 날짜가 있는 건 1개) 임베딩 공간에
# 존재하지 않는다. 그래서 "마감 임박한 업무 뭐야?"는 유사도 검색으로 원리상 못 찾는다 -
# 뽑히는 건 마감이 급한 업무가 아니라 문장이 비슷한 아무 업무다. 집계와 같은 방식으로
# 목록을 SQL로 확정해 넣는다.
#
# 임박과 지난 마감을 한 목록에 합치면 안 된다. 실측으로 이 프로젝트는 지난 마감이 48건이라
# 날짜순 한 목록에서는 지난 것들이 상한을 다 먹고 7일 내 16건이 한 줄도 안 나왔다.
# 목록을 나눠 각각 상한을 두고, 지난 마감은 오래된 것보다 최근 것이 급하므로 내림차순으로 본다.
#
# COUNT(*) OVER ()로 잘라내기 전 건수를 같이 받는다. 집계 쪽 due_soon/overdue는 프로젝트
# 전체라, 개인화 질문으로 목록만 좁혀졌을 때 "외 N건"이 어긋나기 때문이다.
_DUE_SOON_LIST_SQL = """
SELECT t.due_date, t.title, u.name AS assignee_name, COUNT(*) OVER () AS match_total
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1
  AND t.status <> 'done'
  AND t.due_date IS NOT NULL
  AND t.due_date >= CURRENT_DATE
  AND t.due_date < CURRENT_DATE + $2::int
  AND ($3::bigint IS NULL OR t.assignee_id = $3)
ORDER BY t.due_date, t.id
LIMIT $4
"""

_OVERDUE_LIST_SQL = """
SELECT t.due_date, t.title, u.name AS assignee_name, COUNT(*) OVER () AS match_total
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1
  AND t.status <> 'done'
  AND t.due_date IS NOT NULL
  AND t.due_date < CURRENT_DATE
  AND ($2::bigint IS NULL OR t.assignee_id = $2)
ORDER BY t.due_date DESC, t.id
LIMIT $3
"""

# "블로커 해결 방법 추천해줘"에 답하려면 건수가 아니라 막힌 이유가 필요하다. 이유는 청크에
# 잘 안 들어가고("블로커"는 본문 단어가 아니라 status 값이라 유사도 검색에 안 걸린다) 설령
# 걸려도 상위 5건에 들어온다는 보장이 없어, 마감 목록과 같은 방식으로 SQL로 확정한다.
#
# 정렬이 곧 "무엇을 보여줄지"다 - 상한이 작아서 급한 것이 잘려 나가면 목록이 있으나 마나다.
# 우선순위(high>medium>low)를 먼저 보고, 같으면 마감이 가까운 순으로 본다. 마감이 없는 건은
# 급한지 알 수 없으므로 NULLS LAST로 뒤에 둔다.
#
# 상태 문자열은 파라미터로 넘긴다. SQL에 'blocked'를 또 박으면 _BLOCKED_STATUS와 두 벌이 되어
# 한쪽만 바뀔 때 목록과 건수가 조용히 어긋난다.
_BLOCKED_LIST_SQL = """
SELECT t.title, t.description, t.due_date, t.priority,
       u.name AS assignee_name, COUNT(*) OVER () AS match_total
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1
  AND t.status = $2
  AND ($3::bigint IS NULL OR t.assignee_id = $3)
ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         t.due_date NULLS LAST, t.id
LIMIT $4
"""

# 프롬프트에 매번 붙는 줄이라 상한을 둔다. 넘는 만큼은 "외 N건"으로 알린다.
# 임박 쪽을 더 크게 잡는다 - 지난 마감은 "얼마나 밀렸나"를 알리는 정도면 된다.
_DUE_SOON_LIST_LIMIT = 5
_OVERDUE_LIST_LIMIT = 3
# 블로커는 건당 사유까지 붙어 한 줄이 길다. 3건이 넘어가면 무관한 질문의 프롬프트까지 무겁다.
_BLOCKED_LIST_LIMIT = 3

_UNASSIGNED_LABEL = "미배정"
_BLOCKED_STATUS = "blocked"


async def fetch_project_stats(pool, project_id: int, assignee_id: int | None = None) -> dict | None:
    """프로젝트 전체 업무를 집계한다. 조회에 실패하거나 업무가 없으면 None.

    assignee_id를 주면 그 사람 몫을 "mine"으로 함께 접는다. 쿼리는 이미 담당자별로
    묶여 있어 같은 결과에서 골라내면 되므로 DB 왕복이 늘지 않는다. 이게 없으면
    "내 업무 알려줘"에 모델이 출처 표본 5건을 세어 "총 5건"이라 답한다(실제 30건).

    집계는 부가 정보이므로 실패해도 예외를 올리지 않는다 - 답변 품질만 떨어지고
    응답 자체는 정상적으로 나간다(task_facts_service와 같은 방침).
    """
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(_PROJECT_STATS_SQL, project_id, _DUE_SOON_DAYS)
            due_soon_rows = await conn.fetch(
                _DUE_SOON_LIST_SQL, project_id, _DUE_SOON_DAYS, assignee_id, _DUE_SOON_LIST_LIMIT
            )
            overdue_rows = await conn.fetch(
                _OVERDUE_LIST_SQL, project_id, assignee_id, _OVERDUE_LIST_LIMIT
            )
            blocked_rows = await conn.fetch(
                _BLOCKED_LIST_SQL, project_id, _BLOCKED_STATUS, assignee_id, _BLOCKED_LIST_LIMIT
            )
    except Exception:
        # 삼켜도 되는 실패지만 원인까지 버리면 운영에서 왜 집계가 빠졌는지 알 수 없다.
        logger.warning(
            "프로젝트 통계 조회 실패, 집계 없이 답변을 생성합니다. project_id=%s",
            project_id,
            exc_info=True,
        )
        return None

    if not rows:
        return None

    by_status: dict[str, int] = {}
    # key는 assignee_id(미배정이면 None), value는 (표시 이름, 건수).
    blocked_by_assignee: dict[int | None, tuple[str, int]] = {}
    total = 0
    due_soon = 0
    overdue = 0
    mine_by_status: dict[str, int] = {}
    mine_total = 0
    mine_due_soon = 0

    for row in rows:
        count = row["cnt"]
        # 행의 담당자를 파라미터와 같은 이름으로 두면 아래 블로커 집계가 질문자 ID를 덮어써
        # 이후 행이 엉뚱한 사람과 비교된다(실측: 본인 30건이 25건으로 나옴).
        row_assignee_id = row["assignee_id"]
        total += count
        due_soon += row["due_soon_cnt"]
        overdue += row["overdue_cnt"]
        by_status[row["status"]] = by_status.get(row["status"], 0) + count
        if assignee_id is not None and row_assignee_id == assignee_id:
            mine_total += count
            mine_due_soon += row["due_soon_cnt"]
            mine_by_status[row["status"]] = mine_by_status.get(row["status"], 0) + count
        if row["status"] == _BLOCKED_STATUS:
            name = row["assignee_name"] or _UNASSIGNED_LABEL
            _, prev = blocked_by_assignee.get(row_assignee_id, (name, 0))
            blocked_by_assignee[row_assignee_id] = (name, prev + count)

    def _items(rows) -> list[dict]:
        return [
            {"due_date": r["due_date"], "title": r["title"], "assignee_name": r["assignee_name"]}
            for r in rows
        ]

    def _remaining(rows) -> int:
        return rows[0]["match_total"] - len(rows) if rows else 0

    due_soon_list = _items(due_soon_rows)
    overdue_list = _items(overdue_rows)
    blocked_list = [
        {
            "title": r["title"],
            "description": r["description"],
            "due_date": r["due_date"],
            "priority": r["priority"],
            "assignee_name": r["assignee_name"],
        }
        for r in blocked_rows
    ]

    return {
        "total": total,
        "by_status": by_status,
        "blocked_by_assignee": sorted(blocked_by_assignee.values(), key=lambda nc: -nc[1]),
        "due_soon": due_soon,
        "overdue": overdue,
        "due_soon_list": due_soon_list,
        "due_soon_remaining": _remaining(due_soon_rows),
        "overdue_list": overdue_list,
        "overdue_remaining": _remaining(overdue_rows),
        "blocked_list": blocked_list,
        "blocked_remaining": _remaining(blocked_rows),
        # 담당 업무가 0건이면 개인 블록 자체를 넣지 않는다. "내 업무 0건"이 컨텍스트에 있으면
        # 모델이 그걸 근거로 단정한다(_format_stats의 0건 항목 생략과 같은 이유).
        "mine": (
            {"total": mine_total, "by_status": mine_by_status, "due_soon": mine_due_soon}
            if mine_total
            else None
        ),
    }
