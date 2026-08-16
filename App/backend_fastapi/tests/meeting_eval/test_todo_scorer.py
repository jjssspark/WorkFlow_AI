from __future__ import annotations

from app.main import MeetingTodo
from meeting_eval.dataset import GoldenTodo
from meeting_eval.todo_scorer import score_todos


def _golden(evidence_id="T1", title="임베딩 모델 교체", assignee="박지수",
            due_date="2026-08-14", priority="HIGH", snippet="임베딩 모델 교체"):
    return GoldenTodo(evidence_id=evidence_id, title=title, assignee=assignee,
                      due_date=due_date, priority=priority, evidence_snippet=snippet)


def _predicted(title="임베딩 모델 교체", assignee="박지수", due_date="2026-08-14",
               priority="HIGH", evidence="박지수 · 임베딩 모델 교체 · 8/14"):
    return MeetingTodo(title=title, description="", assignee_candidate=assignee,
                       due_date=due_date, priority=priority, category="AI",
                       evidence_text=evidence)


def test_perfect_prediction_scores_one():
    score = score_todos([_predicted()], [_golden()])

    assert score.precision == 1.0
    assert score.recall == 1.0
    assert score.f1 == 1.0
    assert score.assignee_accuracy == 1.0
    assert score.due_date_accuracy == 1.0
    assert score.priority_accuracy == 1.0
    assert score.fallback_matched == 0


def test_missing_todo_lowers_recall_not_precision():
    score = score_todos([_predicted()], [_golden(), _golden("T2", snippet="재색인 점검")])

    assert score.precision == 1.0
    assert score.recall == 0.5


def test_invented_todo_lowers_precision():
    invented = _predicted(title="회식 장소 예약", evidence="원문에 없는 문장")
    score = score_todos([_predicted(), invented], [_golden()])

    assert score.precision == 0.5
    assert score.recall == 1.0


def test_wrong_assignee_keeps_match_but_lowers_field_accuracy():
    score = score_todos([_predicted(assignee="유소은")], [_golden()])

    assert score.recall == 1.0
    assert score.assignee_accuracy == 0.0
    assert score.due_date_accuracy == 1.0


def test_empty_evidence_falls_back_to_title_overlap():
    score = score_todos([_predicted(evidence="")], [_golden()])

    assert score.recall == 1.0
    assert score.fallback_matched == 1


def test_no_prediction_scores_zero_without_dividing_by_zero():
    score = score_todos([], [_golden()])

    assert score.precision == 0.0
    assert score.recall == 0.0
    assert score.f1 == 0.0
    assert score.assignee_accuracy == 0.0
