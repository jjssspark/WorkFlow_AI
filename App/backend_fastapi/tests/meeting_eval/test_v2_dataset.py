"""신양식(4열) 평가셋의 불변조건.

이 셋은 기존 12건과 **내용도 정답도 같고 실행항목 형식만 다르다**. 그래야 점수 차이가
양식 때문인지 다른 요인 때문인지 갈린다. 한쪽만 손대면 그 대조가 조용히 깨진다.
"""

from __future__ import annotations

from pathlib import Path

from meeting_eval.dataset import load_cases

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
V1 = FIXTURES / "meeting_eval"
V2 = FIXTURES / "meeting_eval_v2"


def test_golden_answers_match_the_old_format_set():
    """정답이 갈라지면 두 셋의 점수를 나란히 놓을 수 없다."""
    v1 = {case.case_id: case for case in load_cases(V1)}

    for case in load_cases(V2):
        original = v1[case.case_id]
        assert [
            (todo.evidence_id, todo.title, todo.assignee, todo.due_date, todo.priority)
            for todo in case.golden.todos
        ] == [
            (todo.evidence_id, todo.title, todo.assignee, todo.due_date, todo.priority)
            for todo in original.golden.todos
        ], case.case_id


def test_action_items_use_the_four_column_shape():
    """체크박스 표기가 남아 있으면 구양식 경로로 파싱돼 신양식을 재지 못한다."""
    for case in load_cases(V2):
        todos = case.request.sections.todos
        assert "[" not in todos, case.case_id
        assert "·" not in todos, case.case_id
        assert todos.strip(), case.case_id


def test_every_row_ends_with_a_priority_value():
    """우선순위 값이 행의 끝을 표시한다. 없으면 다음 행과 합쳐진다."""
    for case in load_cases(V2):
        lines = [line for line in case.request.sections.todos.split("\n") if line.strip()]
        assert lines[-1] in {"긴급", "보통", "낮음"}, case.case_id


def test_every_golden_todo_snippet_appears_in_the_source():
    for case in load_cases(V2):
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
