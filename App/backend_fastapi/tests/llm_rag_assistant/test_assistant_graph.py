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


# role에 기본값을 두지 않는다. 모든 도구가 팀장 전용이라 기본값을 LEADER로 두면, 권한을
# 검증하려던 테스트가 역할을 빠뜨렸을 때 조용히 통과해버린다(권한 검사가 prepare 노드 맨
# 앞이라 MEMBER면 대상 업무 해소 전에 막히는데 그 차이가 드러나지 않는다).
# 명시를 강제해 각 테스트가 어떤 역할을 전제하는지 호출부에서 바로 보이게 한다.
def _state(question: str, *, role: str) -> dict:
    return {
        "question": question,
        "history": [],
        "project_id": 1,
        "user_id": 2,
        "user_role": role,
    }


@pytest.mark.asyncio
async def test_leader_command_produces_confirm_card() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무 생성 모달 구현")),
    ):
        outcome = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "change_status"
    assert outcome.card.task_id == 37
    assert outcome.thread_id


@pytest.mark.asyncio
async def test_member_is_blocked_for_status_change() -> None:
    """상태 변경은 보드 화면에서는 멤버도 할 수 있지만 어시스턴트 경로는 팀장 전용이다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="change_status", task_ref="WF-250", args={"to": "done"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무 생성 모달 구현")),
    ):
        outcome = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="MEMBER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "팀장" in outcome.message


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
async def test_tool_outside_supported_set_is_blocked_even_for_leader() -> None:
    """실행기가 수행 못 하는 도구는 권한을 통과해도 카드를 만들지 않는다
    (누르면 프론트가 거부하는 계약 불일치 방지).

    지금은 모든 도구를 실행기가 지원해 실제 미지원 도구가 없다. 그래도 이 가드는 도구를
    추가할 때 실행기 구현을 잊지 않게 하는 장치라, 집합을 좁혀 주입해 살려둔다.
    """
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="delete_task", task_ref="WF-250", args={})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=37, title="업무")),
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.SUPPORTED_TOOLS",
        frozenset({"change_status"}),
    ):
        outcome = await start_command(object(), _state("업무 삭제해줘", role="LEADER"))

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
async def test_leader_can_rename_task() -> None:
    """rename_task는 팀장 전용이고 실행기가 지원한다. 팀장은 확인 카드를 받는다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="rename_task", task_ref="WF-250", args={"title": "로그인 API 리팩터링"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=61, title="로그인 개선")),
    ):
        outcome = await start_command(object(), _state("WF-250 이름 바꿔줘", role="LEADER"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "rename_task"
    assert outcome.card.task_id == 61
    assert outcome.card.args["title"] == "로그인 API 리팩터링"
    # 카드 요약에 바뀔 이름이 보여야 사용자가 승인 전에 확인할 수 있다.
    assert "로그인 API 리팩터링" in outcome.card.summary


@pytest.mark.asyncio
async def test_leader_can_change_assignee() -> None:
    """change_assignee는 팀장 전용이고 실행기가 지원한다. 팀장은 확인 카드를 받는다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="change_assignee", task_ref="WF-250", args={"assignee_name": "김철수"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=72, title="결제 모듈 연동")),
    ):
        outcome = await start_command(object(), _state("WF-250 담당자 김철수로 바꿔줘", role="LEADER"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "change_assignee"
    assert outcome.card.task_id == 72
    assert outcome.card.args["assignee_name"] == "김철수"
    # 카드는 이름만 싣는다. 실제 id 해소는 프론트 실행기가 멤버 목록을 받아 처리한다.
    assert "김철수" in outcome.card.summary


@pytest.mark.asyncio
async def test_leader_can_delete_task() -> None:
    """delete_task는 되돌릴 수 없어 확인 카드가 유일한 안전장치다. 카드가 반드시 떠야 한다."""
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="delete_task", task_ref="WF-250", args={})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=88, title="쓰지 않는 배치 스크립트")),
    ):
        outcome = await start_command(object(), _state("WF-250 삭제해줘", role="LEADER"))

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "delete_task"
    assert outcome.card.task_id == 88
    # 무엇이 지워지는지 요약에 드러나야 사용자가 승인 전에 되돌릴 수 없음을 판단할 수 있다.
    assert "쓰지 않는 배치 스크립트" in outcome.card.summary
    assert "삭제" in outcome.card.summary


@pytest.mark.asyncio
async def test_member_is_blocked_for_delete_task() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="delete_task", task_ref="WF-250", args={})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=88, title="쓰지 않는 배치 스크립트")),
    ):
        outcome = await start_command(object(), _state("삭제해줘", role="MEMBER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "팀장" in outcome.message


@pytest.mark.asyncio
async def test_member_is_blocked_for_change_assignee() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="change_assignee", task_ref="WF-250", args={"assignee_name": "김철수"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=72, title="결제 모듈 연동")),
    ):
        outcome = await start_command(object(), _state("담당자 바꿔줘", role="MEMBER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "팀장" in outcome.message


@pytest.mark.asyncio
async def test_member_is_blocked_for_rename_task() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="rename_task", task_ref="WF-250", args={"title": "새 이름"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=61, title="로그인 개선")),
    ):
        outcome = await start_command(object(), _state("이름 바꿔줘", role="MEMBER"))

    assert outcome.type == "done"
    assert outcome.card is None
    assert "팀장" in outcome.message


@pytest.mark.asyncio
async def test_empty_plan_asks_again() -> None:
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=[])
    ):
        outcome = await start_command(object(), _state("어쩌구 저쩌구 해줘", role="LEADER"))

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
        outcome = await start_command(object(), _state("없는 업무에 코멘트 남겨줘", role="LEADER"))

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
        outcome = await start_command(object(), _state("로그인에 코멘트 남겨줘", role="LEADER"))

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
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))
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
        first = await start_command(object(), _state("두 업무 상태 바꿔줘", role="LEADER"))
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
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))
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
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))
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
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))
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
        started = await start_command(object(), _state("WF-250 완료로 바꿔줘", role="LEADER"))
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
        outcome = await start_command(object(), _state("어쩌구 저쩌구 해줘", role="LEADER"))

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


@pytest.mark.asyncio
async def test_nudge_card_shows_what_the_notification_will_say() -> None:
    """재촉 알림도 되돌릴 수 없다. 어떤 내용이 나가는지 요약에 드러나야 한다.

    delete_task와 같은 이유다. 다만 이쪽은 지워지는 게 아니라 남에게 알림이 가는 것이라,
    "재촉한다"만으로는 부족하고 세 종류 중 무엇인지가 보여야 사용자가 판단할 수 있다.
    """
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="nudge_task", task_ref="결제 모듈", args={"kind": "URGENT"})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=91, title="결제 모듈 구현")),
    ):
        outcome = await start_command(
            object(), _state("결제 모듈 급하니 확인하라고 알려줘", role="LEADER")
        )

    assert outcome.type == "confirm"
    assert outcome.card is not None
    assert outcome.card.tool == "nudge_task"
    assert outcome.card.args == {"kind": "URGENT"}
    assert "결제 모듈 구현" in outcome.card.summary
    # 종류 코드(URGENT)가 아니라 사람이 읽을 수 있는 문구여야 한다.
    assert "긴급" in outcome.card.summary
    assert "URGENT" not in outcome.card.summary


@pytest.mark.asyncio
async def test_completion_approval_is_blocked_for_member_role() -> None:
    """완료 승인은 팀장 전용이다. 멤버에게는 카드를 만들지 않는다.

    최종 방어선은 Spring의 @PreAuthorize지만, 누르면 반드시 403이 될 버튼을 보여주지
    않기 위해 여기서 먼저 막는다.
    """
    from llm_rag_assistant.app.graph.assistant_graph import start_command

    plan = [Action(tool="approve_completion", task_ref="결제 모듈", args={})]
    with patch(
        "llm_rag_assistant.app.graph.assistant_graph.plan_actions", new=AsyncMock(return_value=plan)
    ), patch(
        "llm_rag_assistant.app.graph.assistant_graph.resolve_task_ref",
        new=AsyncMock(return_value=TaskMatch(task_id=91, title="결제 모듈 구현")),
    ):
        blocked = await start_command(
            object(), _state("결제 모듈 완료 승인해줘", role="MEMBER")
        )
        allowed = await start_command(
            object(), _state("결제 모듈 완료 승인해줘", role="LEADER")
        )

    assert blocked.card is None
    # 거부만 확인하면 "무조건 거부"하는 구현도 통과한다. 팀장은 통과해야 한다.
    assert allowed.type == "confirm"
    assert allowed.card is not None
    assert allowed.card.tool == "approve_completion"
