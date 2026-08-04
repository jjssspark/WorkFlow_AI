from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# 청크 본문(document_chunks.content)에는 제목과 설명만 들어간다. 마감일·상태·우선순위·담당자는
# tasks/meeting_action_items 테이블에만 있어, 이를 붙여주지 않으면 "그 업무 언제까지야?"에
# 모델이 근거 없음으로 답한다. 임베딩에 굽지 않고 검색 후 조회하는 이유는 마감일이 바뀔 때마다
# 재임베딩이 필요해지는 것을 피하고 항상 최신값을 쓰기 위해서다.
#
# 담당자도 같은 이유로 여기서 붙인다. 배정은 회의록 등록 이후에도 계속 바뀌는데 제목은 안 바뀐다.
# 담당자를 안 넘겼을 때 모델은 근거 없음이 아니라 제목 문구를 읽었다 - 회의록 양식이 담당자 칸을
# 제목에 흘려 넣는 탓에 제목이 "담당 미정 · ..."으로 시작하는 업무에 대해, 실제로는 박지수가
# 배정돼 있는데도 "담당자는 미정입니다"라고 답했다(2026-08-04 운영 실측).

_TASK_FACTS_SQL = """
SELECT t.id, t.due_date, t.status, t.priority, u.name AS assignee_name
FROM tasks t
LEFT JOIN users u ON u.id = t.assignee_id
WHERE t.project_id = $1 AND t.id = ANY($2::bigint[])
"""

# meeting_action_items에는 project_id가 없어 meetings를 조인해야 프로젝트 범위를 강제할 수 있다.
# 이 조건이 빠지면 타 프로젝트 업무의 마감일이 컨텍스트에 실릴 수 있다.
#
# 담당자는 final_assignee_id 를 쓴다. recommended_assignee_id 는 AI가 회의록에서 뽑은 후보이고,
# 사람이 역할분배 화면에서 확정한 값이 final_assignee_id 다. 후보를 답하면 확정과 어긋난다.
_ACTION_ITEM_FACTS_SQL = """
SELECT ai.id, ai.due_date, ai.priority, u.name AS assignee_name
FROM meeting_action_items ai
JOIN meetings m ON m.id = ai.meeting_id
LEFT JOIN users u ON u.id = ai.final_assignee_id
WHERE m.project_id = $1 AND ai.id = ANY($2::bigint[])
"""

_TASK_SOURCE_TYPE = "task"
_ACTION_ITEM_SOURCE_TYPE = "action_item"


def _collect_source_ids(rows: list[dict], source_type: str) -> list[int]:
    return sorted({row["source_id"] for row in rows if row.get("source_type") == source_type})


async def _fetch_facts(pool, project_id: int, task_ids: list[int], action_item_ids: list[int]) -> dict:
    facts_by_key: dict[tuple[str, int], dict] = {}

    async with pool.acquire() as conn:
        if task_ids:
            for row in await conn.fetch(_TASK_FACTS_SQL, project_id, task_ids):
                facts_by_key[(_TASK_SOURCE_TYPE, row["id"])] = {
                    "due_date": row["due_date"],
                    "status": row["status"],
                    "priority": row["priority"],
                    # 배정이 없으면 None 그대로 둔다. "미배정"이라는 표기는 generation_service가
                    # 정한다 - 라벨을 두 곳에서 정하면 같은 화면에서 표기가 갈린다.
                    "assignee_name": row["assignee_name"],
                }
        if action_item_ids:
            for row in await conn.fetch(_ACTION_ITEM_FACTS_SQL, project_id, action_item_ids):
                # 액션아이템에는 상태 컬럼이 없다. 키를 빼지 않고 None으로 채워 두면
                # 소비 측(generation_service)이 source_type별로 분기하지 않아도 된다.
                facts_by_key[(_ACTION_ITEM_SOURCE_TYPE, row["id"])] = {
                    "due_date": row["due_date"],
                    "status": None,
                    "priority": row["priority"],
                    "assignee_name": row["assignee_name"],
                }

    return facts_by_key


async def enrich_with_facts(pool, project_id: int, rows: list[dict]) -> list[dict]:
    """검색된 청크에 마감일·상태·우선순위를 붙인 새 리스트를 반환한다.

    조회에 실패하거나 해당 source_id가 프로젝트 안에 없으면 facts는 None이다.
    사실 조회는 부가 기능이므로 실패해도 예외를 올리지 않는다 - 답변 품질만 떨어지고
    응답 자체는 정상적으로 나간다.
    """
    task_ids = _collect_source_ids(rows, _TASK_SOURCE_TYPE)
    action_item_ids = _collect_source_ids(rows, _ACTION_ITEM_SOURCE_TYPE)

    if not task_ids and not action_item_ids:
        return [{**row, "facts": None} for row in rows]

    try:
        facts_by_key = await _fetch_facts(pool, project_id, task_ids, action_item_ids)
    except Exception:
        logger.warning("업무 사실 조회 실패, 마감일 없이 답변을 생성합니다.")
        facts_by_key = {}

    return [
        {**row, "facts": facts_by_key.get((row.get("source_type"), row["source_id"]))}
        for row in rows
    ]
