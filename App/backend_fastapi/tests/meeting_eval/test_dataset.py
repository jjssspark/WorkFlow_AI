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


def test_covers_all_planned_scenarios():
    scenarios = {case.scenario for case in load_cases(FIXTURES)}

    assert scenarios == {
        "양식 준수",
        "구분자 생략",
        "우선순위 미체크",
        "To-Do 다수",
        "담당자 미지정",
        "기한 표현 다양",
        "자유 서술",
        "환각 유도",
    }


def test_every_golden_todo_snippet_appears_in_the_source():
    """정답의 근거 조각이 회의록 원문에 실제로 있어야 매칭이 성립한다.
    정답을 손으로 쓰다 보면 원문에 없는 조각을 적기 쉬워 여기서 막는다."""
    for case in load_cases(FIXTURES):
        source = case.request.text or ""
        if case.request.sections is not None:
            source += "".join([
                case.request.sections.discussion,
                case.request.sections.decisions,
                case.request.sections.todos,
                case.request.sections.issues,
            ])
        normalized = "".join(source.split())
        for todo in case.golden.todos:
            snippet = "".join(todo.evidence_snippet.split())
            assert snippet in normalized, f"{case.case_id}/{todo.evidence_id}: {snippet}"


def test_golden_snippets_are_mutually_distinct_within_a_case():
    """한 케이스 안에서 근거 조각이 서로 부분문자열이면 greedy 매칭이 엉킨다.
    먼저 처리된 정답이 남의 예측을 가져가 뒤 정답이 굶는다."""
    for case in load_cases(FIXTURES):
        snippets = ["".join(todo.evidence_snippet.split()) for todo in case.golden.todos]
        for i, left in enumerate(snippets):
            for j, right in enumerate(snippets):
                if i != j:
                    assert left not in right, f"{case.case_id}: {left!r} ⊂ {right!r}"
