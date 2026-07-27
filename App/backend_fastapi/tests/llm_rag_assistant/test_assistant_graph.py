from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from llm_rag_assistant.app.graph.state import Action
from llm_rag_assistant.app.graph.task_resolver import TaskCandidate, TaskMatch


@pytest.fixture(autouse=True)
def use_memory_checkpointer(monkeypatch: pytest.MonkeyPatch) -> None:
    from langgraph.checkpoint.memory import InMemorySaver

    from llm_rag_assistant.app.graph import assistant_graph

    compiled = assistant_graph._build().compile(checkpointer=InMemorySaver())

    async def _get_graph():
        return compiled

    monkeypatch.setattr(assistant_graph, "get_graph", _get_graph)
    # 대기 스레드 추적은 모듈 전역이라 테스트 간 누수를 막기 위해 매 테스트 초기화한다.
    assistant_graph._pending_threads.clear()


def _state(question: str, role: str = "MEMBER") -> dict:
    return {
        "question": question,
        "history": [],
        "project_id": 1,
        "user_id": 2,
        "user_role": role,
    }


@pytest.mark.asyncio
async def test_member_command_produces_confirm_card() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무 생성 모달 구현")),
    ):
        outcome = await start_command(object(), _state("WF-250 완료로 바꿔줘"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "change_status"
    assert outcome.card.task_id == 37
    assert outcome.thread_id


@pytest.mark.asyncio
async def test_member_is_blocked_before_card_for_leader_tool() -> None:
    """권한 없는 작업은 카드를 만들지 않는다. 누르면 실패할 버튼을 보여주지 않기 위해서다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="set_due_date", task_ref="WF-250", args={"date": "2026-08-10"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        outcome = await start_command(object(), _state("마감일 8월 10일로 지정해줘", role="MEMBER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "팀장" in outcome.message


@pytest.mark.asyncio
async def test_leader_tool_blocked_as_unsupported_even_for_leader() -> None:
    """실행기가 아직 수행 못 하는 팀장 도구는 권한을 통과해도 카드를 만들지 않는다
    (누르면 프론트가 거부하는 계약 불일치 방지)."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    # change_assignee는 아직 실행기 미구현이라 SUPPORTED_TOOLS에 없다.
    plan = [Action(tool="change_assignee", task_ref="WF-250", args={"assignee_name": "김철수"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        outcome = await start_command(object(), _state("담당자 바꿔줘", role="LEADER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "지원하지 않" in outcome.message


@pytest.mark.asyncio
async def test_leader_can_set_due_date() -> None:
    """set_due_date는 팀장 전용이지만 이제 실행기가 지원한다. 팀장은 확인 카드를 받는다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="set_due_date", task_ref="WF-250", args={"date": "2026-08-10"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=50, title="FS-3 대시보드/지연 위험도 WF-195")),
    ):
        outcome = await start_command(object(), _state("마감일 8월 10일로 지정해줘", role="LEADER"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "set_due_date"
    assert outcome.card.task_id == 50
    assert outcome.card.args["date"] == "2026-08-10"


@pytest.mark.asyncio
async def test_empty_plan_asks_again() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=[])
    ):
        outcome = await start_command(object(), _state("어쩌구 저쩌구 해줘"))

    assert outcome.type == "done"
    assert outcome.card is None


@pytest.mark.asyncio
async def test_unresolved_task_reports_not_found() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="add_comment", task_ref="없는 업무", args={"content": "확인"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch()),
    ):
        outcome = await start_command(object(), _state("없는 업무에 코멘트 남겨줘"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "찾지 못했" in outcome.message


@pytest.mark.asyncio
async def test_ambiguous_task_asks_user_to_choose() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="add_comment", task_ref="로그인", args={"content": "확인"})]
    match = TaskMatch(
        candidates=[
            TaskCandidate(task_id=37, title="로그인 API 구현"),
            TaskCandidate(task_id=38, title="로그인 화면 개선"),
        ]
    )
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=match),
    ):
        outcome = await start_command(object(), _state("로그인에 코멘트 남겨줘"))

    assert outcome.type == "done"
    assert "로그인 API 구현" in outcome.message
    assert "로그인 화면 개선" in outcome.message


@pytest.mark.asyncio
async def test_resume_with_success_completes_command() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무 생성 모달 구현")),
    ):
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘"))
        resumed = await resume_command(
            started.thread_id, {"step_id": started.card.step_id, "ok": True}
        )

    assert resumed.type == "done"
    assert resumed.card is None


@pytest.mark.asyncio
async def test_multi_action_plan_resumes_each_step_sequentially() -> None:
    """액션이 여러 개인 계획은 승인마다 다음 카드를 돌려주고, 마지막에 완료한다.

    회귀 방어: 재개 후 다음 단계가 또 confirm이면 체크포인트를 지우면 안 된다.
    지우면 후속 승인이 aget_state에서 스레드를 못 찾아 만료 처리된다.
    """
    from llm_rag_assistant.app.graph import assistant_graph
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [
        Action(tool="change_status", task_ref="WF-250", args={"to": "inprogress"}),
        Action(tool="change_status", task_ref="WF-251", args={"to": "done"}),
    ]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        first = await start_command(object(), _state("두 업무 상태 바꿔줘"))
        assert first.type == "confirm"

        second = await resume_command(first.thread_id, {"step_id": first.card.step_id, "ok": True})
        # 첫 승인 후 두 번째 단계가 또 승인을 기다린다. 체크포인트는 유지돼야 한다.
        assert second.type == "confirm"
        assert second.card is not None
        assert second.card.step_id != first.card.step_id
        assert first.thread_id in assistant_graph._pending_threads

        final = await resume_command(first.thread_id, {"step_id": second.card.step_id, "ok": True})

    assert final.type == "done"
    assert "2개 작업을 완료했습니다" in final.message
    assert first.thread_id not in assistant_graph._pending_threads


@pytest.mark.asyncio
async def test_resume_with_failure_reports_it() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘"))
        resumed = await resume_command(
            started.thread_id,
            {"step_id": started.card.step_id, "ok": False, "error": "업무를 찾을 수 없습니다"},
        )

    assert resumed.type == "done"
    assert "업무를 찾을 수 없습니다" in resumed.message


@pytest.mark.asyncio
async def test_resume_rejects_mismatched_step_id() -> None:
    """대기 중인 단계와 다른 step_id로 온 결과는 그래프를 진행시키지 않는다
    (잘못됐거나 재전송된 결과 방어)."""
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘"))
        resumed = await resume_command(
            started.thread_id, {"step_id": "9-deadbeef", "ok": True}
        )

    assert resumed.type == "done"
    assert "일치하지 않" in resumed.message or "이미 처리" in resumed.message
    assert resumed.card is None


@pytest.mark.asyncio
async def test_resume_rejects_when_pending_step_cannot_be_determined(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """대기 단계를 특정하지 못하면(step_id 추출 실패) fail-closed로 거부한다."""
    from llm_rag_assistant.app.graph import assistant_graph
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘"))
        monkeypatch.setattr(assistant_graph, "_pending_step_id", lambda snapshot: None)
        resumed = await resume_command(
            started.thread_id, {"step_id": started.card.step_id, "ok": True}
        )

    assert resumed.type == "done"
    assert resumed.card is None
    assert "일치하지 않" in resumed.message or "이미 처리" in resumed.message


@pytest.mark.asyncio
async def test_expired_thread_is_reported() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import resume_command

    outcome = await resume_command("nonexistent-thread-id", {"step_id": "x", "ok": True})
    assert outcome.type == "done"
    assert "만료" in outcome.message


@pytest.mark.asyncio
async def test_resume_discards_checkpoint_to_reclaim_memory() -> None:
    """재개가 끝나면 스레드 체크포인트를 지워 InMemorySaver 메모리가 쌓이지 않게 한다."""
    from llm_rag_assistant.app.graph import assistant_graph
    from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ):
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘"))
        # 승인 대기 스레드는 추적되고 체크포인트가 남아 있다.
        assert started.thread_id in assistant_graph._pending_threads
        await resume_command(started.thread_id, {"step_id": started.card.step_id, "ok": True})

    graph = await assistant_graph.get_graph()
    config = {"configurable": {"thread_id": started.thread_id}}
    snapshot = await graph.aget_state(config)
    assert started.thread_id not in assistant_graph._pending_threads
    assert not snapshot.values  # 체크포인트가 삭제돼 남은 상태가 없다.


@pytest.mark.asyncio
async def test_start_command_discards_thread_for_terminal_outcome() -> None:
    """즉시 끝난 발화(빈 계획 등)는 재개될 일이 없으니 체크포인트를 바로 버린다."""
    from llm_rag_assistant.app.graph import assistant_graph
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=[])
    ):
        outcome = await start_command(object(), _state("어쩌구 저쩌구 해줘"))

    assert outcome.type == "done"
    assert outcome.thread_id not in assistant_graph._pending_threads
    graph = await assistant_graph.get_graph()
    snapshot = await graph.aget_state({"configurable": {"thread_id": outcome.thread_id}})
    assert not snapshot.values


@pytest.mark.asyncio
async def test_sweep_removes_only_expired_pending_threads(monkeypatch: pytest.MonkeyPatch) -> None:
    """재개 없이 만료(30분 초과)된 대기 스레드만 sweep이 삭제한다(취소·무시된 카드)."""
    import time
    from types import SimpleNamespace

    from llm_rag_assistant.app.graph import assistant_graph

    deleted: list[str] = []

    async def _adelete(thread_id: str) -> None:
        deleted.append(thread_id)

    graph = SimpleNamespace(checkpointer=SimpleNamespace(adelete_thread=_adelete))

    now = time.monotonic()
    assistant_graph._pending_threads.clear()
    assistant_graph._pending_threads["old"] = now - assistant_graph._CHECKPOINT_TTL_SECONDS - 1
    assistant_graph._pending_threads["fresh"] = now

    await assistant_graph._sweep_expired_threads(graph)

    assert deleted == ["old"]
    assert "old" not in assistant_graph._pending_threads
    assert "fresh" in assistant_graph._pending_threads
