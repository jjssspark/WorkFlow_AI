"""AI 추출 평가셋의 불변조건.

기존 `meeting_eval` 평가셋과 같은 검증을 걸되, 이 셋에만 해당하는 조건이 두 개 더 있다.
실행항목 칸이 비어 있어야 하고(안 그러면 규칙 기반 덮어쓰기가 걸려 LLM 을 재지 못한다),
정답이 0건인 케이스가 있어야 한다(환각을 재려면 필요하다).
"""

from __future__ import annotations

from pathlib import Path

from meeting_eval.dataset import load_cases

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "meeting_eval_extraction"


def test_action_item_cell_is_always_empty():
    """실행항목 칸이 차 있으면 `_analyze_json_uncached` 가 LLM 결과를 버리고
    규칙 기반으로 덮어쓴다. 그러면 이 평가셋은 추출이 아니라 옮겨 적기를 재게 된다."""
    for case in load_cases(FIXTURES):
        assert case.request.sections is not None, case.case_id
        assert case.request.sections.todos.strip() == "", case.case_id


def test_has_cases_with_nothing_to_extract():
    """할 일이 없는 회의에서 지어내지 않는지가 추출 품질의 핵심이다."""
    cases = load_cases(FIXTURES)
    empty = [case for case in cases if not case.golden.todos]

    assert len(empty) >= 3, [case.case_id for case in cases]


def test_every_golden_todo_snippet_appears_in_the_source():
    for case in load_cases(FIXTURES):
        sections = case.request.sections
        source = "".join([
            case.request.text or "",
            sections.discussion,
            sections.decisions,
            sections.todos,
            sections.issues,
        ])
        normalized = "".join(source.split())
        for todo in case.golden.todos:
            snippet = "".join(todo.evidence_snippet.split())
            assert snippet in normalized, f"{case.case_id}/{todo.evidence_id}: {snippet}"


def test_golden_snippets_are_mutually_distinct_within_a_case():
    """한 케이스 안에서 근거 조각이 서로 부분문자열이면 greedy 매칭이 엉킨다."""
    for case in load_cases(FIXTURES):
        snippets = ["".join(todo.evidence_snippet.split()) for todo in case.golden.todos]
        for i, left in enumerate(snippets):
            for j, right in enumerate(snippets):
                if i != j:
                    assert left not in right, f"{case.case_id}: {left!r} ⊂ {right!r}"


def test_cases_are_sorted_by_case_id():
    cases = load_cases(FIXTURES)

    assert [case.case_id for case in cases] == sorted(case.case_id for case in cases)
