from __future__ import annotations

from pathlib import Path

from app.main import MeetingAnalysisResult, MeetingMeta
from meeting_eval.dataset import load_cases
from meeting_eval.runner import run_eval

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "meeting_eval"


def _empty_result(request):
    return MeetingAnalysisResult(
        summary="", decisions=[], todos=[], risks=[], keywords=[],
        meeting_meta=MeetingMeta(title=request.title, meeting_date=request.meeting_date,
                                 participants=request.participants),
    )


def test_report_covers_every_case():
    cases = load_cases(FIXTURES)

    report = run_eval(cases, analyze=_empty_result, judge_ask=lambda p: "아니오", provider="stub")

    assert report.provider == "stub"
    assert [r.case_id for r in report.results] == [c.case_id for c in cases]
    assert report.mean_f1 == 0.0


def test_analysis_failure_scores_zero_without_stopping():
    cases = load_cases(FIXTURES)

    def explode(request):
        if request.title == cases[0].request.title:
            raise RuntimeError("모델 응답 실패")
        return _empty_result(request)

    report = run_eval(cases, analyze=explode, judge_ask=lambda p: "아니오", provider="stub")

    assert len(report.results) == len(cases)
    assert report.results[0].todo.f1 == 0.0


def test_rows_are_flat_for_dataframe():
    cases = load_cases(FIXTURES)[:1]

    rows = run_eval(cases, analyze=_empty_result, judge_ask=lambda p: "예", provider="stub").to_rows()

    assert set(rows[0]) >= {"case_id", "scenario", "provider", "f1", "precision", "recall",
                            "assignee_accuracy", "due_date_accuracy", "priority_accuracy",
                            "summary_score"}
