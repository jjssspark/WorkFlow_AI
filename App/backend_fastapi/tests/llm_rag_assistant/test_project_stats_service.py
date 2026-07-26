from __future__ import annotations

from datetime import date

import pytest

from llm_rag_assistant.app.services.project_stats_service import fetch_project_stats


class _FakeConn:
    """집계 쿼리와 마감 임박 목록 쿼리를 본문으로 구분해 각각의 행을 돌려준다."""

    def __init__(
        self,
        rows: list[dict],
        due_soon_rows: list[dict] | None = None,
        overdue_rows: list[dict] | None = None,
    ) -> None:
        self._rows = rows
        self._due_soon_rows = due_soon_rows or []
        self._overdue_rows = overdue_rows or []
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        if "COUNT(*) OVER ()" not in query:
            return self._rows
        return self._overdue_rows if "DESC" in query else self._due_soon_rows

    def call_for(self, marker: str) -> tuple:
        return next(call for call in self.calls if marker in call[0])

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


def _row(
    status: str,
    name: str | None,
    count: int,
    due_soon: int = 0,
    assignee_id: int | None = None,
    overdue: int = 0,
) -> dict:
    return {
        "status": status,
        "assignee_id": assignee_id if assignee_id is not None else (hash(name) if name else None),
        "assignee_name": name,
        "cnt": count,
        "due_soon_cnt": due_soon,
        "overdue_cnt": overdue,
    }


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
async def test_keeps_same_named_assignees_apart() -> None:
    pool = _FakePool(_FakeConn([
        _row("blocked", "허영주", 8, assignee_id=1),
        _row("blocked", "허영주", 4, assignee_id=2),
    ]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["blocked_by_assignee"] == [("허영주", 8), ("허영주", 4)]


@pytest.mark.asyncio
async def test_due_soon_window_is_half_open() -> None:
    conn = _FakeConn([_row("todo", "허영주", 1)])

    await fetch_project_stats(_FakePool(conn), 1)

    query, args = conn.calls[0]
    assert "t.due_date >= CURRENT_DATE" in query
    assert "t.due_date < CURRENT_DATE + $2::int" in query
    assert args[1] == 7


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
async def test_counts_the_askers_own_tasks_when_an_assignee_is_given() -> None:
    """'내 업무 알려줘'에 모델이 출처 5건을 세어 '총 5건'이라 답한다(실측: 실제 30건)."""
    pool = _FakePool(_FakeConn([
        _row("todo", "허영주", 20, due_soon=3, assignee_id=1),
        _row("done", "허영주", 10, assignee_id=1),
        _row("todo", "김팀원", 7, due_soon=2, assignee_id=2),
    ]))

    stats = await fetch_project_stats(pool, 1, assignee_id=1)

    assert stats["mine"] == {"total": 30, "by_status": {"todo": 20, "done": 10}, "due_soon": 3}
    assert stats["total"] == 37


@pytest.mark.asyncio
async def test_personal_totals_survive_blocked_rows_from_other_people() -> None:
    """블로커 집계가 질문자 ID를 덮어쓰면 이후 행이 엉뚱한 사람과 비교된다(실측: 30건→25건)."""
    pool = _FakePool(_FakeConn([
        _row("blocked", "김팀원", 5, assignee_id=2),
        _row("todo", "허영주", 15, assignee_id=1),
        _row("blocked", "허영주", 3, assignee_id=1),
        _row("done", "허영주", 9, assignee_id=1),
        _row("inprogress", "허영주", 3, assignee_id=1),
    ]))

    stats = await fetch_project_stats(pool, 1, assignee_id=1)

    assert stats["mine"]["total"] == 30
    assert stats["mine"]["by_status"] == {"todo": 15, "blocked": 3, "done": 9, "inprogress": 3}


@pytest.mark.asyncio
async def test_has_no_personal_section_without_an_assignee() -> None:
    pool = _FakePool(_FakeConn([_row("todo", "허영주", 20, assignee_id=1)]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["mine"] is None


@pytest.mark.asyncio
async def test_has_no_personal_section_when_the_asker_owns_nothing() -> None:
    """담당 업무가 0건인데 '내 업무 0건' 블록을 넣으면 모델이 그걸 근거로 단정한다."""
    pool = _FakePool(_FakeConn([_row("todo", "허영주", 20, assignee_id=1)]))

    stats = await fetch_project_stats(pool, 1, assignee_id=99)

    assert stats["mine"] is None


def _due_row(due_date: str, title: str, name: str | None, match_total: int) -> dict:
    return {
        "due_date": date.fromisoformat(due_date),
        "title": title,
        "assignee_name": name,
        "match_total": match_total,
    }


@pytest.mark.asyncio
async def test_lists_due_soon_tasks_nearest_first() -> None:
    """마감일은 임베딩에 없어 유사도 검색으로는 못 찾는다. 목록을 SQL로 확정해 넣는다."""
    conn = _FakeConn(
        [_row("todo", "허영주", 20, due_soon=3, assignee_id=1)],
        due_soon_rows=[
            _due_row("2026-07-26", "업무 상세 우측 패널 구현", "허영주", 9),
            _due_row("2026-07-27", "대시보드 위험도 표시", None, 9),
        ],
    )

    stats = await fetch_project_stats(_FakePool(conn), 1)

    assert [item["title"] for item in stats["due_soon_list"]] == [
        "업무 상세 우측 패널 구현",
        "대시보드 위험도 표시",
    ]
    assert stats["due_soon_list"][1]["assignee_name"] is None
    assert stats["due_soon_remaining"] == 7


@pytest.mark.asyncio
async def test_overdue_list_is_separate_and_most_recent_first() -> None:
    """한 목록에 합치면 지난 마감이 상한을 다 먹는다(실측: 지난 48건에 밀려 임박 16건이 0줄)."""
    conn = _FakeConn(
        [_row("todo", "허영주", 20)],
        due_soon_rows=[_due_row("2026-07-26", "임박 업무", "허영주", 1)],
        overdue_rows=[_due_row("2025-12-28", "밀린 업무", "이은주", 48)],
    )

    stats = await fetch_project_stats(_FakePool(conn), 1)

    assert [item["title"] for item in stats["due_soon_list"]] == ["임박 업무"]
    assert [item["title"] for item in stats["overdue_list"]] == ["밀린 업무"]
    assert stats["overdue_remaining"] == 47
    assert conn.call_for("ORDER BY t.due_date DESC")


@pytest.mark.asyncio
async def test_both_lists_are_scoped_to_the_asker_for_personal_questions() -> None:
    """개인화 질문에 남의 업무를 섞으면 모델이 그걸 본인 것처럼 답한다(retrieval_service와 같은 방침)."""
    conn = _FakeConn([_row("todo", "허영주", 1, assignee_id=1)])

    await fetch_project_stats(_FakePool(conn), 1, assignee_id=7)

    assert conn.call_for("ORDER BY t.due_date, t.id")[1][2] == 7
    assert conn.call_for("ORDER BY t.due_date DESC")[1][1] == 7


@pytest.mark.asyncio
async def test_counts_overdue_tasks_separately() -> None:
    """목록에는 지난 마감이 섞여 나오므로, 숫자 쪽에도 같은 기준의 값이 있어야 설명이 맞는다."""
    pool = _FakePool(_FakeConn([
        _row("todo", "허영주", 20, due_soon=3, overdue=4),
        _row("done", "허영주", 10),
    ]))

    stats = await fetch_project_stats(pool, 1)

    assert stats["overdue"] == 4


@pytest.mark.asyncio
async def test_returns_none_when_project_has_no_tasks() -> None:
    stats = await fetch_project_stats(_FakePool(_FakeConn([])), 1)

    assert stats is None


@pytest.mark.asyncio
async def test_returns_none_when_query_fails() -> None:
    stats = await fetch_project_stats(_RaisingPool(), 1)

    assert stats is None
