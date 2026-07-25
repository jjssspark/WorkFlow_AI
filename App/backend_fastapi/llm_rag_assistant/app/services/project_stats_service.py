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
    ) AS due_soon_cnt
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1
GROUP BY t.status, t.assignee_id, u.name
"""

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
        by_status[row["status"]] = by_status.get(row["status"], 0) + count
        if assignee_id is not None and row_assignee_id == assignee_id:
            mine_total += count
            mine_due_soon += row["due_soon_cnt"]
            mine_by_status[row["status"]] = mine_by_status.get(row["status"], 0) + count
        if row["status"] == _BLOCKED_STATUS:
            name = row["assignee_name"] or _UNASSIGNED_LABEL
            _, prev = blocked_by_assignee.get(row_assignee_id, (name, 0))
            blocked_by_assignee[row_assignee_id] = (name, prev + count)

    return {
        "total": total,
        "by_status": by_status,
        "blocked_by_assignee": sorted(blocked_by_assignee.values(), key=lambda nc: -nc[1]),
        "due_soon": due_soon,
        # 담당 업무가 0건이면 개인 블록 자체를 넣지 않는다. "내 업무 0건"이 컨텍스트에 있으면
        # 모델이 그걸 근거로 단정한다(_format_stats의 0건 항목 생략과 같은 이유).
        "mine": (
            {"total": mine_total, "by_status": mine_by_status, "due_soon": mine_due_soon}
            if mine_total
            else None
        ),
    }
