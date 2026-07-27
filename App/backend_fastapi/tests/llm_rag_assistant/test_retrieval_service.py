from __future__ import annotations

import pytest

from llm_rag_assistant.app.services.retrieval_service import search_similar_chunks


class _FakeConn:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        return self._rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.mark.asyncio
async def test_search_uses_bound_parameters_not_string_concatenation() -> None:
    rows = [{"source_type": "meeting", "source_id": 1, "content": "내용", "similarity": 0.9}]
    conn = _FakeConn(rows)
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=7, query_embedding=[0.1, 0.2], top_k=5)

    assert result == rows
    query, args = conn.calls[0]
    # project_id, top_k가 SQL 문자열에 직접 삽입되지 않고 바인딩 파라미터로만 전달되는지 검증
    assert "7" not in query
    assert args == ("[0.10000000,0.20000000]", 7, 5)


@pytest.mark.asyncio
async def test_search_filters_by_project_id_parameter() -> None:
    conn = _FakeConn([])
    pool = _FakePool(conn)

    await search_similar_chunks(pool, project_id=99, query_embedding=[0.5], top_k=3)

    _, args = conn.calls[0]
    assert args[1] == 99


class _FakeSequenceConn:
    """호출 순서대로 다른 결과를 반환하는 fake conn (일반 검색 → 타입별 예약 검색 순서 검증용)."""

    def __init__(self, responses: list[list[dict]]) -> None:
        self._responses = responses
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        index = len(self.calls) - 1
        return self._responses[index]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSequencePool:
    def __init__(self, conn: _FakeSequenceConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.mark.asyncio
async def test_search_reserves_meeting_slots_when_general_search_finds_none() -> None:
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9},
        {"source_type": "action_item", "source_id": 2, "content": "액션1", "similarity": 0.85},
        {"source_type": "task", "source_id": 3, "content": "업무2", "similarity": 0.8},
        {"source_type": "action_item", "source_id": 4, "content": "액션2", "similarity": 0.75},
        {"source_type": "task", "source_id": 5, "content": "업무3", "similarity": 0.7},
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의 요약", "similarity": 0.6},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 2
    assert any(row["source_type"] == "meeting" for row in result)
    assert len(result) == 5


@pytest.mark.asyncio
async def test_search_does_not_reserve_meeting_slots_when_already_present() -> None:
    general_rows = [
        {"source_type": "meeting", "source_id": 1, "content": "회의 요약", "similarity": 0.9},
        {"source_type": "task", "source_id": 2, "content": "업무1", "similarity": 0.8},
    ]
    conn = _FakeSequenceConn([general_rows])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 1
    assert result == general_rows


@pytest.mark.asyncio
async def test_search_skips_reservation_when_no_meeting_chunks_exist_at_all() -> None:
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9},
    ]
    conn = _FakeSequenceConn([general_rows, []])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 2
    assert result == general_rows


# --- 상위 K개 정렬 보장 (UT-194) -------------------------------------------
# 일반 검색만 타면 정렬·개수는 SQL의 ORDER BY/LIMIT가 책임진다. 하지만 meeting 슬롯
# 예약이 걸리면 두 결과를 파이썬에서 잘라 붙이므로, top_k 상한과 내림차순이 그 병합
# 경로에서도 유지되는지는 SQL이 보장해주지 않는다.


@pytest.mark.asyncio
async def test_merged_results_stay_sorted_by_similarity_desc() -> None:
    """예약된 meeting 청크가 뒤에 덧붙기만 하면 유사도 높은 근거가 목록 끝으로 밀린다.

    LLM 컨텍스트는 앞쪽 근거에 더 강하게 반응하므로 병합 후 반드시 재정렬돼야 한다.
    """
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.90},
        {"source_type": "task", "source_id": 2, "content": "업무2", "similarity": 0.85},
        {"source_type": "action_item", "source_id": 3, "content": "액션1", "similarity": 0.80},
        {"source_type": "task", "source_id": 4, "content": "업무3", "similarity": 0.75},
        {"source_type": "task", "source_id": 5, "content": "업무4", "similarity": 0.70},
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의 요약", "similarity": 0.95},
        {"source_type": "meeting", "source_id": 11, "content": "회의 상세", "similarity": 0.60},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=5)

    assert [row["similarity"] for row in result] == [0.95, 0.90, 0.85, 0.80, 0.60]
    assert result[0]["source_id"] == 10


@pytest.mark.asyncio
async def test_merged_results_never_exceed_top_k() -> None:
    """일반 결과 top_k개 + 예약 meeting개가 그대로 합쳐지면 상한을 넘는다.

    상한을 넘기면 프롬프트 길이가 예측 불가능해지고 토큰 비용이 조용히 늘어난다.
    """
    general_rows = [
        {"source_type": "task", "source_id": index, "content": f"업무{index}", "similarity": 0.9 - index / 100}
        for index in range(5)
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의1", "similarity": 0.5},
        {"source_type": "meeting", "source_id": 11, "content": "회의2", "similarity": 0.4},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=5)

    assert len(result) == 5
    assert result == sorted(result, key=lambda row: row["similarity"], reverse=True)


@pytest.mark.asyncio
async def test_merged_results_respect_top_k_of_one() -> None:
    """top_k가 예약 슬롯 수(2)보다 작은 경계. 상한이 1이면 결과도 1건이어야 한다."""
    general_rows = [{"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9}]
    meeting_rows = [{"source_type": "meeting", "source_id": 10, "content": "회의1", "similarity": 0.5}]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=1)

    assert len(result) == 1
    # 예약 검색에 넘기는 limit도 top_k를 넘지 않아야 한다.
    _, reserve_args = conn.calls[1]
    assert reserve_args[3] == 1


@pytest.mark.asyncio
async def test_top_k_is_passed_to_sql_limit_on_general_search() -> None:
    """병합이 없을 때는 SQL LIMIT이 상한을 책임진다 - top_k가 그대로 전달돼야 한다."""
    general_rows = [{"source_type": "meeting", "source_id": 1, "content": "회의", "similarity": 0.9}]
    conn = _FakeSequenceConn([general_rows])

    await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=3)

    query, args = conn.calls[0]
    assert "ORDER BY embedding" in query
    assert "LIMIT" in query
    assert args[2] == 3


@pytest.mark.asyncio
async def test_search_filters_by_assignee_id_when_provided() -> None:
    assignee_rows = [{"source_type": "task", "source_id": 1, "content": "내 업무", "similarity": 0.9}]
    conn = _FakeConn(assignee_rows)
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5, assignee_id=42)

    assert result == assignee_rows
    query, args = conn.calls[0]
    assert "assignee_id" in query
    assert args == ("[0.10000000]", 1, 42, 5)


@pytest.mark.asyncio
async def test_search_does_not_fall_back_to_general_search_when_assignee_has_no_chunks() -> None:
    """담당 업무가 없을 때 프로젝트 전체 검색으로 대체하면 다른 사람의 업무가 컨텍스트에 섞여
    LLM이 그걸 질문자 본인의 담당 업무처럼 답할 수 있다 - 반드시 빈 결과를 그대로 반환해야 한다."""
    conn = _FakeConn([])
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5, assignee_id=42)

    assert result == []
    assert len(conn.calls) == 1
