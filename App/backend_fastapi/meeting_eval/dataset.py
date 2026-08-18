"""평가 케이스 픽스처를 읽어 분석 요청과 정답으로 바꾼다."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from app.main import AnalyzeRequest
from meeting_eval.summary_judge import COVERAGE, SAFETY, ChecklistItem

_CHECKLIST_KINDS = frozenset({COVERAGE, SAFETY})


@dataclass(frozen=True)
class GoldenTodo:
    evidence_id: str
    title: str
    assignee: str
    due_date: Optional[str]
    priority: str
    # 예측 To-Do와 정답을 잇는 열쇠. 제목이 아니라 근거 문장으로 매칭해야
    # 제목 다듬기 작업이 매칭을 흔들지 않는다.
    evidence_snippet: str


@dataclass(frozen=True)
class Golden:
    todos: List[GoldenTodo]
    summary_checklist: List[ChecklistItem]


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    scenario: str
    request: AnalyzeRequest
    golden: Golden


def load_cases(fixtures_dir: Path) -> List[EvalCase]:
    cases = [_load_case(path) for path in sorted(fixtures_dir.glob("*.json"))]
    return sorted(cases, key=lambda case: case.case_id)


def _load_case(path: Path) -> EvalCase:
    raw = json.loads(path.read_text(encoding="utf-8"))
    golden_raw = raw["golden"]
    return EvalCase(
        case_id=raw["case_id"],
        scenario=raw["scenario"],
        request=AnalyzeRequest(**raw["input"]),
        golden=Golden(
            todos=[GoldenTodo(**todo) for todo in golden_raw["todos"]],
            summary_checklist=[
                _checklist_item(raw_item, path)
                for raw_item in golden_raw["summary_checklist"]
            ],
        ),
    )


def _checklist_item(raw_item: dict, path: Path) -> ChecklistItem:
    """문항 유형을 반드시 픽스처에서 읽는다.

    기본값을 두면 `kind`를 빠뜨린 문항이 조용히 충실도로 세어져, 안전성 문항이 사라진
    것을 아무도 모른 채 점수만 오른다. 지표를 고치는 중에 지표를 다시 망가뜨리는 길이라
    여기서는 관대하게 넘기지 않는다.
    """
    kind = raw_item.get("kind")
    if kind not in _CHECKLIST_KINDS:
        raise ValueError(
            f"{path.name}: summary_checklist 항목의 kind 가 {sorted(_CHECKLIST_KINDS)} 중 "
            f"하나여야 하는데 {kind!r} 입니다."
        )
    return ChecklistItem(text=raw_item["item"], kind=kind)
