from __future__ import annotations

import re
from datetime import date
from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field, model_validator

# 도구 목록을 한 곳에서만 정의한다. 계획 노드의 허용 목록, 권한 판정, 프론트 실행기 매핑이
# 서로 어긋나면 "카드는 떴는데 실행이 안 되는" 상태가 되므로 여기가 유일한 기준이다.
#
# 어시스턴트로 하는 업무 변경은 전부 팀장 전용이다. 보드 화면에서는 멤버도 상태 변경·코멘트·
# 체크리스트를 할 수 있지만(Spring은 그 API들을 isMember로 허용한다), 대화로 하는 변경은
# 대상 업무를 유사도로 추정하는 단계가 끼어 오작동 시 되돌리기가 어렵다. 그래서 어시스턴트
# 경로만 더 좁게 잡는다. 멤버 전용 도구는 없다.
MEMBER_TOOLS: frozenset[str] = frozenset()
LEADER_TOOLS: frozenset[str] = frozenset(
    {
        "change_status",
        "add_comment",
        "toggle_checklist",
        "rename_task",
        "set_due_date",
        "change_assignee",
        "delete_task",
    }
)
ALL_TOOLS: frozenset[str] = MEMBER_TOOLS | LEADER_TOOLS

# 프론트 실행기(actionExecutor.ts)가 실제로 수행할 수 있는 도구. 이 집합에 없는 도구는
# 그래프가 확인 카드를 만들어도 실행 단계에서 거부돼 "카드는 떴는데 안 되는" 계약 불일치가
# 생기므로 prepare에서 차단한다. 실행기에 도구를 추가하면 여기도 반드시 함께 넓힌다.
#
# 권한(LEADER_TOOLS)과는 별개의 축이라 파생시키지 않고 따로 나열한다. 예전에는 MEMBER_TOOLS에서
# 파생했는데, 그러면 권한 재배치만으로 실행 가능 목록이 딸려 바뀌어 카드가 통째로 사라진다.
SUPPORTED_TOOLS: frozenset[str] = frozenset(
    {"change_status", "add_comment", "toggle_checklist", "set_due_date"}
)

_VALID_STATUSES: frozenset[str] = frozenset({"todo", "inprogress", "blocked", "done"})
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ToolName = Literal[
    "change_status",
    "add_comment",
    "toggle_checklist",
    "rename_task",
    "set_due_date",
    "change_assignee",
    "delete_task",
]


def requires_leader(tool: str) -> bool:
    return tool in LEADER_TOOLS


def _require_str(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key}가 비어 있거나 문자열이 아닙니다")
    return value


class Action(BaseModel):
    """계획 노드가 만든 작업 하나. Literal 덕분에 모르는 도구 이름은 파싱 단계에서 거부된다."""

    tool: ToolName
    # "WF-250" 또는 "로그인 업무" - 아직 실제 id가 아니다. task_resolver가 변환한다.
    task_ref: str
    args: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate(self) -> "Action":
        # task_ref는 유사도 검색의 입력이다. 비면 아무 업무나 최상위로 걸릴 수 있어 거부한다.
        if not self.task_ref or not self.task_ref.strip():
            raise ValueError("task_ref가 비어 있습니다")

        # 도구별 필수 args를 파싱 단계에서 검증한다. 여기서 걸리면 parse_plan이 빈 계획으로
        # 처리해 되묻기로 안전하게 빠진다(엉뚱한 값이 확인 카드·실행으로 새지 않는다).
        args = self.args
        if self.tool == "change_status":
            if args.get("to") not in _VALID_STATUSES:
                raise ValueError("change_status args.to가 유효한 상태값이 아닙니다")
        elif self.tool == "add_comment":
            _require_str(args, "content")
        elif self.tool == "toggle_checklist":
            _require_str(args, "item")
            if not isinstance(args.get("done"), bool):
                raise ValueError("toggle_checklist args.done가 불리언이 아닙니다")
        elif self.tool == "rename_task":
            _require_str(args, "title")
        elif self.tool == "set_due_date":
            date_str = _require_str(args, "date")
            if not _DATE_PATTERN.match(date_str):
                raise ValueError("set_due_date args.date는 YYYY-MM-DD 형식이어야 합니다")
            # 형식만 보면 2026-99-99 같은 비존재 날짜가 통과한다. 실제 달력 날짜인지 확인한다.
            try:
                date.fromisoformat(date_str)
            except ValueError:
                raise ValueError("set_due_date args.date가 존재하지 않는 날짜입니다")
        elif self.tool == "change_assignee":
            _require_str(args, "assignee_name")
        # delete_task는 필수 args 없음
        return self


class CommandState(TypedDict, total=False):
    question: str
    history: list[dict]
    # 아래 3개는 Spring이 인증 세션에서 주입한 값이다. 대화 기록에서 유도하지 않는다.
    project_id: int
    user_id: int | None
    user_role: str
    plan: list[dict]      # Action.model_dump() 목록 (체크포인터 직렬화를 위해 dict로 보관)
    cursor: int
    results: list[dict]
    final_message: str
