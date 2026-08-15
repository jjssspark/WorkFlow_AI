from __future__ import annotations

from pathlib import Path

from meeting_eval.dataset import load_cases

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "meeting_eval"


def test_loads_case_with_sections_and_golden():
    cases = load_cases(FIXTURES)

    case = next(c for c in cases if c.case_id == "formal-01")
    assert case.scenario == "양식 준수"
    assert case.request.participants == ["박지수", "유소은"]
    assert case.request.sections is not None
    assert "임베딩 모델 교체" in case.request.sections.todos
    assert [todo.evidence_id for todo in case.golden.todos] == ["T1", "T2"]
    assert case.golden.todos[0].due_date == "2026-08-14"
    assert case.golden.todos[0].priority == "HIGH"
    assert len(case.golden.summary_checklist) == 2


def test_cases_are_sorted_by_case_id():
    cases = load_cases(FIXTURES)

    assert [c.case_id for c in cases] == sorted(c.case_id for c in cases)
