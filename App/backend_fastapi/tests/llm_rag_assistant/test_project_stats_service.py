from __future__ import annotations

import pytest

from llm_rag_assistant.app.services.project_stats_service import fetch_project_stats


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


def _row(status: str, name: str | None, count: int, due_soon: int = 0) -> dict:
    return {"status": status, "assignee_name": name, "cnt": count, "due_soon_cnt": due_soon}


@pytest.mark.asyncio
async def test_aggregates_total_and_per_status_counts() -> None:
    pool = _FakePool(_FakeConn([
        _row("blocked", "허영주", 8),
        _row("blocked", "김팀원", 4),
        _row("inprogress", "허영주", 3),
        _row("done", "김팀원", 1),
    ]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["total"] == 16
    assert stats["by_status"]["blocked"] == 12
    assert stats["by_status"]["inprogress"] == 3
    assert stats["by_status"]["done"] == 1


@pytest.mark.asyncio
async def test_groups_blocked_tasks_by_assignee_most_first() -> None:
    pool = _FakePool(_FakeConn([
        _row("blocked", "김팀원", 4),
        _row("blocked", "허영주", 8),
        _row("blocked", None, 1),
        _row("todo", "허영주", 9),
    ]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["blocked_by_assignee"] == [("허영주", 8), ("김팀원", 4), ("미배정", 1)]


@pytest.mark.asyncio
async def test_sums_due_soon_counts_across_rows() -> None:
    pool = _FakePool(_FakeConn([
        _row("inprogress", "허영주", 3, due_soon=2),
        _row("todo", "김팀원", 2, due_soon=1),
    ]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["due_soon"] == 3


@pytest.mark.asyncio
async def test_query_is_scoped_by_project_id() -> None:
    conn = _FakeConn([_row("todo", "허영주", 1)])

    await fetch_project_stats(_FakePool(conn), 42)

    query, args = conn.calls[0]
    assert "project_id = $1" in query
    assert args[0] == 42


@pytest.mark.asyncio
async def test_returns_none_when_project_has_no_tasks() -> None:
    stats = await fetch_project_stats(_FakePool(_FakeConn([])), 1)

    assert stats is None


@pytest.mark.asyncio
async def test_returns_none_when_query_fails() -> None:
    stats = await fetch_project_stats(_RaisingPool(), 1)

    assert stats is None
