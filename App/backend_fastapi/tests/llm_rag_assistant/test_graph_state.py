from __future__ import annotations

import pytest
from pydantic import ValidationError

from llm_rag_assistant.app.graph.state import (
    ALL_TOOLS,
    MEMBER_TOOLS,
    SUPPORTED_TOOLS,
    Action,
    requires_leader,
)


def test_action_accepts_known_tool() -> None:
    action = Action(tool="change_status", task_ref="WF-250", args={"to": "done"})
    assert action.tool == "change_status"


def test_action_rejects_unknown_tool() -> None:
    """모델이 만들어낸 도구 이름이 실행 경로로 새어나가면 안 된다."""
    with pytest.raises(ValidationError):
        Action(tool="drop_database", task_ref="WF-250", args={})


def test_member_tool_set_is_empty() -> None:
    # 어시스턴트로 하는 업무 변경은 전부 팀장 전용이다. 멤버 전용 도구는 남아 있지 않다.
    assert MEMBER_TOOLS == frozenset()


def test_every_tool_requires_leader() -> None:
    # 도구가 새로 추가돼도 권한 부여를 잊지 않도록 전체를 훑는다.
    assert all(requires_leader(tool) for tool in ALL_TOOLS)


def test_requires_leader_covers_previously_member_tools() -> None:
    # 예전에 멤버도 쓸 수 있던 도구들이 팀장 전용으로 옮겨졌는지 개별로 못 박는다.
    assert requires_leader("change_status") is True
    assert requires_leader("add_comment") is True
    assert requires_leader("toggle_checklist") is True


def test_supported_tools_are_a_subset_of_all_tools() -> None:
    # 실행기가 수행 가능한 도구는 전체 도구의 부분집합이어야 한다.
    assert SUPPORTED_TOOLS <= ALL_TOOLS


def test_rename_task_is_supported_and_leader_only() -> None:
    assert "rename_task" in SUPPORTED_TOOLS
    assert requires_leader("rename_task") is True


def test_rename_task_rejects_empty_title() -> None:
    with pytest.raises(ValidationError):
        Action(tool="rename_task", task_ref="WF-1", args={"title": "   "})


def test_rename_task_rejects_title_over_column_limit() -> None:
    # tasks.title은 VARCHAR(200)이라 더 긴 제목은 DB가 거절해 원인 모를 500이 된다.
    with pytest.raises(ValidationError):
        Action(tool="rename_task", task_ref="WF-1", args={"title": "가" * 201})


def test_rename_task_accepts_title_at_column_limit() -> None:
    action = Action(tool="rename_task", task_ref="WF-1", args={"title": "가" * 200})
    assert len(action.args["title"]) == 200


def test_supported_tools_survive_permission_changes() -> None:
    # SUPPORTED_TOOLS를 권한 집합에서 파생시키면 권한 재배치만으로 카드가 통째로 사라진다.
    # 권한이 전부 팀장으로 옮겨간 뒤에도 실행 가능 목록은 그대로여야 한다.
    assert {"change_status", "add_comment", "toggle_checklist", "set_due_date"} <= SUPPORTED_TOOLS


def test_action_rejects_empty_task_ref() -> None:
    with pytest.raises(ValidationError):
        Action(tool="change_status", task_ref="  ", args={"to": "done"})


def test_change_status_rejects_invalid_status() -> None:
    with pytest.raises(ValidationError):
        Action(tool="change_status", task_ref="WF-1", args={"to": "확인중"})


def test_change_status_requires_to() -> None:
    with pytest.raises(ValidationError):
        Action(tool="change_status", task_ref="WF-1", args={})


def test_add_comment_rejects_empty_content() -> None:
    with pytest.raises(ValidationError):
        Action(tool="add_comment", task_ref="WF-1", args={"content": "   "})


def test_toggle_checklist_requires_item_and_bool_done() -> None:
    with pytest.raises(ValidationError):
        Action(tool="toggle_checklist", task_ref="WF-1", args={"item": "", "done": True})
    with pytest.raises(ValidationError):
        Action(tool="toggle_checklist", task_ref="WF-1", args={"item": "리뷰", "done": "yes"})


def test_toggle_checklist_accepts_valid_args() -> None:
    action = Action(tool="toggle_checklist", task_ref="WF-1", args={"item": "리뷰", "done": False})
    assert action.args["done"] is False


def test_set_due_date_rejects_bad_date_format() -> None:
    with pytest.raises(ValidationError):
        Action(tool="set_due_date", task_ref="WF-1", args={"date": "8월 10일"})


def test_set_due_date_accepts_iso_date() -> None:
    action = Action(tool="set_due_date", task_ref="WF-1", args={"date": "2026-08-10"})
    assert action.args["date"] == "2026-08-10"


def test_set_due_date_rejects_nonexistent_calendar_date() -> None:
    # 형식은 맞지만 존재하지 않는 날짜는 거부한다.
    with pytest.raises(ValidationError):
        Action(tool="set_due_date", task_ref="WF-1", args={"date": "2026-99-99"})
    with pytest.raises(ValidationError):
        Action(tool="set_due_date", task_ref="WF-1", args={"date": "2026-02-30"})


def test_delete_task_needs_no_args() -> None:
    action = Action(tool="delete_task", task_ref="WF-1", args={})
    assert action.tool == "delete_task"
