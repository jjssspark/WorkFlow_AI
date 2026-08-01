from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from llm_rag_assistant.app.services.embedding_service import embed_text
from llm_rag_assistant.app.services.retrieval_service import (
    TASK_CODE_PATTERN,
    find_task_chunks_by_code,
    search_similar_chunks,
)

logger = logging.getLogger(__name__)

_SEARCH_TOP_K = 5
_TITLE_MAX_LEN = 60
# 업무 코드 정규식(TASK_CODE_PATTERN)은 retrieval_service 한 곳에만 둔다. 복제하면 나중에
# 한쪽만 고쳤을 때 명령 경로(여기)와 질문 경로가 서로 다른 코드를 인식하게 된다.

# 1등과 2등의 유사도 차이가 이보다 작으면 "확실하다"고 볼 수 없어 사용자에게 되묻는다.
# 임의로 하나를 골랐다가 엉뚱한 업무를 수정하는 것이 되묻는 것보다 훨씬 나쁘다.
_AMBIGUITY_MARGIN = 0.05
# similarity = 1 - 코사인거리(정규화 임베딩, ~[0,1]). 이 값 미만이면 관련성이 바닥이라
# 단일 결과라도 실제 업무로 확정하지 않고 "못 찾음"으로 처리한다(엉뚱한 업무 조작 방지).
# 정상 매칭은 보통 0.5 이상이라 보수적으로 잡은 노이즈 하한이다.
_MIN_SIMILARITY = 0.3


class TaskCandidate(BaseModel):
    task_id: int
    title: str


class TaskMatch(BaseModel):
    """task_id가 있으면 확정, 없고 candidates가 있으면 선택 필요, 둘 다 없으면 못 찾음."""

    task_id: int | None = None
    title: str = ""
    candidates: list[TaskCandidate] = Field(default_factory=list)


def _shorten(value: str) -> str:
    text = (value or "").strip()
    return text if len(text) <= _TITLE_MAX_LEN else text[: _TITLE_MAX_LEN - 1] + "…"


def _dedup_by_source_id(rows: list[dict]) -> list[dict]:
    seen: set[int] = set()
    unique: list[dict] = []
    for row in rows:
        if row["source_id"] in seen:
            continue
        seen.add(row["source_id"])
        unique.append(row)
    return unique


async def _resolve_by_code(pool, project_id: int, code: str) -> TaskMatch:
    """명시적 업무 코드를 본문 정확 일치로 해소한다.

    코드가 있으면 임베딩으로 되돌아가지 않는다. 존재하지 않는 코드를 유사한 다른 업무로
    억지 매칭하는 것이 바로 이 경로가 막으려는 오작동이기 때문이다(없으면 못 찾음으로 처리).
    """
    try:
        rows = await find_task_chunks_by_code(pool, project_id, code)
    except Exception:
        logger.warning("업무 코드 조회 실패, 후보 없음으로 처리합니다.", exc_info=True)
        return TaskMatch()

    unique = _dedup_by_source_id(rows)
    if not unique:
        return TaskMatch()
    if len(unique) == 1:
        top = unique[0]
        return TaskMatch(task_id=top["source_id"], title=_shorten(top["content"]))
    return TaskMatch(
        candidates=[
            TaskCandidate(task_id=row["source_id"], title=_shorten(row["content"]))
            for row in unique[:3]
        ]
    )


async def resolve_task_ref(pool, project_id: int, task_ref: str) -> TaskMatch:
    """업무 지칭 표현을 실제 task id로 바꾼다.

    "WF-195" 같은 명시적 코드가 있으면 본문 정확 일치를 우선하고, 없으면 임베딩 검색으로
    의미 유사한 업무를 찾는다. 검색이 돌려주는 source_id가 곧 task id다(source_type="task").
    회의록·액션아이템의 source_id는 다른 테이블의 id라 반드시 걸러내야 한다.
    """
    code = TASK_CODE_PATTERN.search(task_ref or "")
    if code:
        return await _resolve_by_code(pool, project_id, code.group(0))

    try:
        embedding = await embed_text(task_ref)
        rows = await search_similar_chunks(pool, project_id, embedding, top_k=_SEARCH_TOP_K)
    except Exception:
        logger.warning("대상 업무 검색 실패, 후보 없음으로 처리합니다.", exc_info=True)
        return TaskMatch()

    task_rows = [row for row in rows if row.get("source_type") == "task"]
    if not task_rows:
        return TaskMatch()

    # search_similar_chunks가 유사도 내림차순으로 준다는 보장에 기대지 않고 여기서 정렬한다.
    task_rows.sort(key=lambda row: row.get("similarity", 0.0), reverse=True)

    # 같은 업무가 여러 청크로 쪼개져 중복으로 올라올 수 있다. 첫 등장(=최고 유사도)만 남긴다.
    seen: set[int] = set()
    unique: list[dict] = []
    for row in task_rows:
        if row["source_id"] in seen:
            continue
        seen.add(row["source_id"])
        unique.append(row)

    top = unique[0]
    # 최상위 후보조차 관련성이 바닥이면 확정도 되묻기도 하지 않고 못 찾음으로 처리한다.
    if top.get("similarity", 0.0) < _MIN_SIMILARITY:
        return TaskMatch()

    if len(unique) > 1 and (top["similarity"] - unique[1]["similarity"]) < _AMBIGUITY_MARGIN:
        return TaskMatch(
            candidates=[
                TaskCandidate(task_id=row["source_id"], title=_shorten(row["content"]))
                for row in unique[:3]
            ]
        )

    return TaskMatch(task_id=top["source_id"], title=_shorten(top["content"]))
