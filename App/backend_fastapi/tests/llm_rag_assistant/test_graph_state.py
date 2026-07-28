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


def test_change_assignee_is_supported_and_leader_only() -> None:
    assert "change_assignee" in SUPPORTED_TOOLS
    assert requires_leader("change_assignee") is True


def test_change_assignee_rejects_empty_name() -> None:
    # 이름이 비면 프론트의 부분 일치가 모든 멤버에 걸려 아무나 배정될 수 있다.
    with pytest.raises(ValidationError):
        Action(tool="change_assignee", task_ref="WF-1", args={"assignee_name": "   "})


def test_delete_task_is_supported_and_leader_only() -> None:
    assert "delete_task" in SUPPORTED_TOOLS
    assert requires_leader("delete_task") is True


# 한때 SUPPORTED_TOOLS == ALL_TOOLS를 단언했으나 뺐다. 도구를 백엔드에 먼저 넣고 실행기를
# 뒤이어 붙이는 정상적인 단계적 개발을 그 단언이 막는다. 실행기 미구현 도구가 사용자에게
# 새어나가는 것은 이 단언이 아니라 그래프 prepare 노드가 막고 있고
# (test_assistant_graph.test_tool_outside_supported_set_is_blocked_even_for_leader),
# 아래 부분집합 단언이 반대 방향(실행기에만 있고 도구 목록엔 없는 오타)을 잡는다.


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


def test_completion_tools_are_supported_and_leader_only() -> None:
    """완료 승인/반려는 팀장만 쓸 수 있고 실행기도 수행할 수 있어야 한다.

    권한(LEADER_TOOLS)과 실행 가능(SUPPORTED_TOOLS)은 별개의 축이다. 한쪽만 넣으면
    카드가 아예 안 나오거나, 카드는 뜨는데 실행 단계에서 거부된다.
    """
    for tool in ("approve_completion", "reject_completion"):
        assert requires_leader(tool) is True
        assert tool in SUPPORTED_TOOLS
        assert Action(tool=tool, task_ref="WF-1", args={}).tool == tool


def test_nudge_task_is_supported_and_leader_only() -> None:
    assert requires_leader("nudge_task") is True
    assert "nudge_task" in SUPPORTED_TOOLS


def test_nudge_task_rejects_unknown_kind() -> None:
    """재촉 알림은 한 번 나가면 회수할 수 없다. 카드가 뜨기 전에 막아야 한다.

    Spring도 400 INVALID_NUDGE_KIND로 거부하지만, 그때는 이미 사용자가 확인 카드를
    누른 뒤다. 잘못된 값이 카드까지 가지 않게 파싱 단계에서 끊는다.
    """
    for bad in ("HURRY", "start", "", None):
        with pytest.raises(ValidationError):
            Action(tool="nudge_task", task_ref="WF-1", args={"kind": bad})
    with pytest.raises(ValidationError):
        Action(tool="nudge_task", task_ref="WF-1", args={})


def test_nudge_task_accepts_the_three_kinds_spring_declares() -> None:
    # Spring TaskController.NUDGE_MESSAGE_TEMPLATES의 키와 같아야 한다.
    for kind in ("START", "PROGRESS", "URGENT"):
        action = Action(tool="nudge_task", task_ref="WF-1", args={"kind": kind})
        assert action.args["kind"] == kind


def test_member_tool_set_is_still_empty_after_adding_leader_tools() -> None:
    """도구를 늘리면서 '대화로 하는 변경은 전부 팀장 전용' 원칙이 새지 않았는지 본다.

    완료 요청/취소(팀원 동작)를 넣고 싶은 유혹이 있는 자리다. 그건 MEMBER_TOOLS를 여는
    별개의 결정이므로, 슬쩍 들어오면 이 테스트가 막는다.
    """
    assert MEMBER_TOOLS == frozenset()
    assert SUPPORTED_TOOLS <= ALL_TOOLS
    assert "request_completion" not in ALL_TOOLS
    assert "cancel_completion" not in ALL_TOOLS
