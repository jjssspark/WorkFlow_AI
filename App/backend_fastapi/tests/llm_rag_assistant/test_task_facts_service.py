from __future__ import annotations

from datetime import date

import pytest

from llm_rag_assistant.app.services.task_facts_service import enrich_with_facts


class _FakeConn:
    """테이블별로 다른 결과를 돌려주는 fake conn.

    task/action_item 조회는 SQL이 서로 달라 호출 순서에 의존하면 테스트가 취약해진다.
    쿼리 문자열로 어느 테이블을 조회하는지 판별해 응답을 고른다.
    """

    def __init__(self, task_rows: list[dict], action_item_rows: list[dict]) -> None:
        self._task_rows = task_rows
        self._action_item_rows = action_item_rows
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        if "meeting_action_items" in query:
            return self._action_item_rows
        return self._task_rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn
        self.acquire_count = 0

    def acquire(self):
        self.acquire_count += 1
        return self._conn


class _RaisingConn:
    async def fetch(self, query: str, *args):
        raise RuntimeError("DB 장애")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _RaisingPool:
    def acquire(self):
        return _RaisingConn()


@pytest.mark.asyncio
async def test_enriches_task_row_with_due_date_status_priority() -> None:
    rows = [{"source_type": "task", "source_id": 12, "content": "로그인 API 구현", "similarity": 0.9}]
    conn = _FakeConn(
        task_rows=[{"id": 12, "due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}],
        action_item_rows=[],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert result[0]["facts"] == {"due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}


@pytest.mark.asyncio
async def test_enriches_action_item_row_from_meeting_action_items_table() -> None:
    rows = [{"source_type": "action_item", "source_id": 5, "content": "배포 스크립트 점검", "similarity": 0.8}]
    conn = _FakeConn(
        task_rows=[],
        action_item_rows=[{"id": 5, "due_date": date(2026, 9, 30), "priority": "medium"}],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert result[0]["facts"] == {"due_date": date(2026, 9, 30), "status": None, "priority": "medium"}


@pytest.mark.asyncio
async def test_meeting_row_gets_no_facts() -> None:
    rows = [{"source_type": "meeting", "source_id": 3, "content": "회의 요약", "similarity": 0.7}]
    conn = _FakeConn(task_rows=[], action_item_rows=[])
    pool = _FakePool(conn)

    result = await enrich_with_facts(pool, project_id=1, rows=rows)

    assert result[0]["facts"] is None
    # 조회할 대상이 없으면 커넥션 자체를 잡지 않는다
    assert pool.acquire_count == 0


@pytest.mark.asyncio
async def test_source_id_missing_from_query_result_gets_no_facts() -> None:
    """검색 결과에 있으나 사실 조회에서 안 나온 source_id는 facts가 붙지 않아야 한다.

    조회 SQL이 project_id로 스코프되므로, 타 프로젝트 청크가 어떤 경로로 섞여 들어와도
    그 업무의 마감일이 컨텍스트에 실리지 않는다.
    """
    rows = [
        {"source_type": "task", "source_id": 12, "content": "내 프로젝트 업무", "similarity": 0.9},
        {"source_type": "task", "source_id": 999, "content": "타 프로젝트 업무", "similarity": 0.8},
    ]
    conn = _FakeConn(
        task_rows=[{"id": 12, "due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}],
        action_item_rows=[],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert result[0]["facts"] is not None
    assert result[1]["facts"] is None


@pytest.mark.asyncio
async def test_queries_are_scoped_by_project_id() -> None:
    rows = [
        {"source_type": "task", "source_id": 1, "content": "업무", "similarity": 0.9},
        {"source_type": "action_item", "source_id": 2, "content": "액션", "similarity": 0.8},
    ]
    conn = _FakeConn(task_rows=[], action_item_rows=[])

    await enrich_with_facts(_FakePool(conn), project_id=42, rows=rows)

    assert len(conn.calls) == 2
    for query, args in conn.calls:
        assert "project_id" in query
        assert 42 in args
        # project_id가 SQL 문자열에 직접 삽입되지 않고 바인딩 파라미터로만 전달되는지 검증
        assert "42" not in query


@pytest.mark.asyncio
async def test_batches_queries_to_avoid_n_plus_one() -> None:
    rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9},
        {"source_type": "task", "source_id": 2, "content": "업무2", "similarity": 0.88},
        {"source_type": "task", "source_id": 3, "content": "업무3", "similarity": 0.86},
        {"source_type": "action_item", "source_id": 4, "content": "액션1", "similarity": 0.8},
        {"source_type": "action_item", "source_id": 5, "content": "액션2", "similarity": 0.78},
    ]
    conn = _FakeConn(task_rows=[], action_item_rows=[])

    await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    # source 5건이어도 테이블당 1회씩 총 2회만 조회한다
    assert len(conn.calls) == 2


@pytest.mark.asyncio
async def test_returns_rows_without_facts_when_query_fails() -> None:
    """사실 조회는 부가 기능이다. 실패해도 답변 생성 자체를 막으면 안 된다."""
    rows = [{"source_type": "task", "source_id": 12, "content": "로그인 API 구현", "similarity": 0.9}]

    result = await enrich_with_facts(_RaisingPool(), project_id=1, rows=rows)

    assert result[0]["facts"] is None
    assert result[0]["content"] == "로그인 API 구현"


@pytest.mark.asyncio
async def test_does_not_mutate_input_rows() -> None:
    rows = [{"source_type": "task", "source_id": 12, "content": "로그인 API 구현", "similarity": 0.9}]
    conn = _FakeConn(
        task_rows=[{"id": 12, "due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}],
        action_item_rows=[],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert "facts" not in rows[0]
    assert result[0] is not rows[0]


@pytest.mark.asyncio
async def test_same_id_in_different_source_types_does_not_swap_facts() -> None:
    """tasks.id와 meeting_action_items.id는 서로 다른 시퀀스라 같은 숫자가 흔히 겹친다.

    facts를 source_id만으로 키잉하면 업무 7의 마감일이 액션아이템 7에 붙어, 사용자는
    존재하지 않는 마감일을 통보받는다. 키는 반드시 (source_type, source_id) 쌍이어야 한다.
    """
    rows = [
        {"source_type": "task", "source_id": 7, "content": "업무 7", "similarity": 0.9},
        {"source_type": "action_item", "source_id": 7, "content": "액션 7", "similarity": 0.8},
    ]
    conn = _FakeConn(
        task_rows=[{"id": 7, "due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}],
        action_item_rows=[{"id": 7, "due_date": date(2026, 9, 30), "priority": "low"}],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert result[0]["facts"] == {"due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}
    assert result[1]["facts"] == {"due_date": date(2026, 9, 30), "status": None, "priority": "low"}


@pytest.mark.asyncio
async def test_preserves_row_order_and_count() -> None:
    """facts 조회 결과의 순서·개수가 입력 행 목록을 바꾸면 안 된다.

    호출 측(chat_service)은 검색 행 목록과 이 반환값을 위치로 대응시켜 쓰기 때문에,
    행이 하나라도 빠지거나 순서가 바뀌면 답변 근거와 표시 출처가 어긋난다.
    """
    rows = [
        {"source_type": "meeting", "source_id": 3, "content": "회의 3", "similarity": 0.95},
        {"source_type": "task", "source_id": 7, "content": "업무 7", "similarity": 0.9},
        {"source_type": "task", "source_id": 999, "content": "조회 안 되는 업무", "similarity": 0.85},
        {"source_type": "action_item", "source_id": 7, "content": "액션 7", "similarity": 0.8},
    ]
    conn = _FakeConn(
        task_rows=[{"id": 7, "due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"}],
        action_item_rows=[{"id": 7, "due_date": date(2026, 9, 30), "priority": "low"}],
    )

    result = await enrich_with_facts(_FakePool(conn), project_id=1, rows=rows)

    assert [(row["source_type"], row["source_id"]) for row in result] == [
        ("meeting", 3),
        ("task", 7),
        ("task", 999),
        ("action_item", 7),
    ]
    # facts가 없는 행도 자리를 지킨다 - 빠뜨리면 뒤 행들이 한 칸씩 밀린다.
    assert result[2]["facts"] is None


@pytest.mark.asyncio
async def test_empty_rows_returns_empty_without_query() -> None:
    conn = _FakeConn(task_rows=[], action_item_rows=[])
    pool = _FakePool(conn)

    result = await enrich_with_facts(pool, project_id=1, rows=[])

    assert result == []
    assert pool.acquire_count == 0
