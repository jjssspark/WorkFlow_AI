"""평가 케이스를 돌려 provider별 리포트를 만든다."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, List, Sequence

from app.main import AnalyzeRequest, MeetingAnalysisResult
from meeting_eval.dataset import EvalCase
from meeting_eval.summary_judge import SummaryScore, judge_summary
from meeting_eval.todo_scorer import TodoScore, score_todos

logger = logging.getLogger(__name__)

_ZERO_TODO = TodoScore(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0, 0, 0)
_ZERO_SUMMARY = SummaryScore(verdicts=[], score=0.0)


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    scenario: str
    todo: TodoScore
    summary: SummaryScore


@dataclass(frozen=True)
class EvalReport:
    provider: str
    results: List[CaseResult]

    @property
    def mean_f1(self) -> float:
        return _mean([result.todo.f1 for result in self.results])

    @property
    def mean_summary_score(self) -> float:
        return _mean([result.summary.score for result in self.results])

    def to_rows(self) -> List[dict]:
        return [
            {
                "case_id": result.case_id,
                "scenario": result.scenario,
                "provider": self.provider,
                "precision": result.todo.precision,
                "recall": result.todo.recall,
                "f1": result.todo.f1,
                "assignee_accuracy": result.todo.assignee_accuracy,
                "due_date_accuracy": result.todo.due_date_accuracy,
                "priority_accuracy": result.todo.priority_accuracy,
                "fallback_matched": result.todo.fallback_matched,
                "summary_score": result.summary.score,
            }
            for result in self.results
        ]


def run_eval(
    cases: Sequence[EvalCase],
    analyze: Callable[[AnalyzeRequest], MeetingAnalysisResult],
    judge_ask: Callable[[str], str],
    provider: str,
) -> EvalReport:
    return EvalReport(
        provider=provider,
        results=[_run_case(case, analyze, judge_ask) for case in cases],
    )


def _run_case(case: EvalCase, analyze, judge_ask) -> CaseResult:
    # 한 케이스가 터져도 나머지 측정은 남아야 한다. 모델 호출은 타임아웃·레이트리밋으로
    # 흔히 실패하는데, 그때마다 전체를 다시 돌리면 측정 자체가 불가능해진다.
    try:
        result = analyze(case.request)
    except Exception:
        logger.warning("분석 실패로 0점 처리. case_id=%s", case.case_id, exc_info=True)
        return CaseResult(case.case_id, case.scenario, _ZERO_TODO, _ZERO_SUMMARY)

    try:
        summary = judge_summary(
            result.summary, result.decisions, case.golden.summary_checklist, judge_ask
        )
    except Exception:
        logger.warning("요약 심사 실패로 0점 처리. case_id=%s", case.case_id, exc_info=True)
        summary = _ZERO_SUMMARY

    return CaseResult(
        case.case_id, case.scenario, score_todos(result.todos, case.golden.todos), summary
    )


def _mean(values: List[float]) -> float:
    return 0.0 if not values else sum(values) / len(values)
