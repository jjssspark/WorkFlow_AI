from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from llm_rag_assistant.app.graph import assistant_graph


@pytest.mark.asyncio
async def test_get_graph_builds_once_under_concurrency(monkeypatch: pytest.MonkeyPatch) -> None:
    """동시 호출에도 그래프는 한 번만 컴파일되고 같은 인스턴스를 공유한다.

    현재 get_graph의 임계구역에는 await가 없어(compile은 동기) 단일 스레드 asyncio에서
    이미 원자적이다. 따라서 이 테스트는 경쟁을 인위로 유발하진 못하고, 사용자에게 중요한
    불변식(중복 컴파일 없이 단일 인스턴스 반환)을 회귀 방지용으로 고정한다. 이중 검사 잠금은
    향후 비동기 초기화가 들어올 때를 위한 방어다.
    """
    monkeypatch.setattr(assistant_graph, "_compiled", None)
    monkeypatch.setattr(assistant_graph, "_graph_lock", asyncio.Lock())

    compiled_sentinel = object()
    builder = MagicMock()
    builder.compile = MagicMock(return_value=compiled_sentinel)

    with patch.object(assistant_graph, "_build", MagicMock(return_value=builder)):
        results = await asyncio.gather(
            *[assistant_graph.get_graph() for _ in range(10)]
        )

    assert all(result is compiled_sentinel for result in results)
    assert builder.compile.call_count == 1


@pytest.mark.asyncio
async def test_close_graph_resets_compiled(monkeypatch: pytest.MonkeyPatch) -> None:
    """종료 시 전역 그래프 상태를 초기화한다(InMemorySaver는 닫을 자원이 없다)."""
    monkeypatch.setattr(assistant_graph, "_compiled", object())
    monkeypatch.setattr(assistant_graph, "_graph_lock", asyncio.Lock())

    await assistant_graph.close_graph()

    assert assistant_graph._compiled is None
