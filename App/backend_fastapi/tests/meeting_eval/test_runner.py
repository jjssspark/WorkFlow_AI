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


def test_report_records_the_tier_that_actually_answered():
    """설정한 provider 와 실제로 답한 티어는 다를 수 있다.

    ollama 로 12건을 돌렸을 때 4건이 ReadTimeout 으로 규칙 기반에 넘어갔는데,
    리포트에는 전부 'ollama' 로만 적혀 두 티어가 섞인 평균이 그대로 나갔다.
    """
    cases = load_cases(FIXTURES)

    def fell_back(request):
        result = _empty_result(request)
        provider = "rule_based" if request.title == cases[0].request.title else "ollama"
        return result.model_copy(update={"analysis_provider": provider})

    report = run_eval(cases, analyze=fell_back, judge_ask=lambda p: "아니오", provider="ollama")

    rows = report.to_rows()
    assert rows[0]["analysis_provider"] == "rule_based"
    assert rows[1]["analysis_provider"] == "ollama"
    assert report.fallback_count == 1


def test_report_counts_cases_where_safety_could_be_measured():
    """안전성 평균 옆에 이 값이 없으면 1.000 을 성과로 읽게 된다.

    12건 전부에서 안전성이 1.000 이었는데, 실제로는 요약이 날짜를 안 써서 검사할
    것이 없었던 것이다. 못 가르는 것과 안 틀린 것은 다르다.
    """
    cases = load_cases(FIXTURES)

    def dated_summary(request):
        return _empty_result(request).model_copy(update={"summary": "8월 10일까지 끝낸다"})

    dated = run_eval(cases, analyze=dated_summary, judge_ask=lambda p: "예", provider="stub")
    silent = run_eval(cases, analyze=_empty_result, judge_ask=lambda p: "예", provider="stub")

    # 날짜를 아예 안 쓴 요약은 12건 전부 안전성 만점이다. 검사가 통과한 것이 아니라
    # 검사할 것이 없었던 것이고, 그 사실은 dated_summary_count 로만 드러난다.
    assert silent.mean_safety == 1.0
    assert silent.dated_summary_count == 0
    assert dated.dated_summary_count == len(cases)
