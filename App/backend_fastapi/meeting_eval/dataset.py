"""평가 케이스 픽스처를 읽어 분석 요청과 정답으로 바꾼다."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from app.main import AnalyzeRequest


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
    summary_checklist: List[str]


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
            summary_checklist=list(golden_raw["summary_checklist"]),
        ),
    )
