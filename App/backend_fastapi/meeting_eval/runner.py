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
# 분석이 터진 케이스는 안전성도 0으로 둔다. 실패한 실행을 "지어내지 않았으니 안전함"
# 으로 세면 장애가 안전성 평균을 끌어올린다.
_ZERO_SUMMARY = SummaryScore(verdicts=[], score=0.0, coverage=0.0, safety=0.0)


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    scenario: str
    todo: TodoScore
    summary: SummaryScore
    # 설정한 provider 가 아니라 실제로 답한 티어. 폴백은 로그에만 남아서, ollama 로
    # 돌린 12건 중 4건이 규칙 기반에 넘어간 것을 모르고 두 티어의 평균을 읽고 있었다.
    analysis_provider: str = "unknown"


@dataclass(frozen=True)
class EvalReport:
    provider: str
    results: List[CaseResult]

    @property
    def mean_f1(self) -> float:
        return _mean([result.todo.f1 for result in self.results])

    @property
    def fallback_count(self) -> int:
        """설정과 다른 티어가 답한 건수. 0 이 아니면 이 리포트의 평균은 섞인 값이다."""
        return sum(1 for result in self.results if not _is_requested_tier(result, self.provider))

    @property
    def mean_summary_score(self) -> float:
        return _mean([result.summary.score for result in self.results])

    @property
    def mean_coverage(self) -> float:
        """담아야 할 것을 담았는가. 무성의한 요약이 떨어지는 축이다."""
        return _mean([result.summary.coverage for result in self.results])

    @property
    def mean_safety(self) -> float:
        """지어내지 않았는가. 아무 말도 안 하면 만점이라 단독으로 읽으면 안 된다."""
        return _mean([result.summary.safety for result in self.results])

    @property
    def dated_summary_count(self) -> int:
        """요약이 날짜를 한 번이라도 쓴 케이스 수. 안전성 평균과 반드시 같이 읽어야 한다.

        이 값이 0 이면 안전성 1.000 은 '안 지어냈다'가 아니라 '검사할 것이 없었다'는
        뜻이다. 36건을 재보니 요약이 날짜를 쓴 것은 2건뿐이었다.
        """
        return sum(1 for result in self.results if result.summary.dated)

    def to_rows(self) -> List[dict]:
        return [
            {
                "case_id": result.case_id,
                "scenario": result.scenario,
                "provider": self.provider,
                "analysis_provider": result.analysis_provider,
                "precision": result.todo.precision,
                "recall": result.todo.recall,
                "f1": result.todo.f1,
                "assignee_accuracy": result.todo.assignee_accuracy,
                "due_date_accuracy": result.todo.due_date_accuracy,
                "priority_accuracy": result.todo.priority_accuracy,
                "fallback_matched": result.todo.fallback_matched,
                "summary_score": result.summary.score,
                "summary_coverage": result.summary.coverage,
                "summary_safety": result.summary.safety,
                "summary_has_date": int(result.summary.dated),
                # 안전성이 0인 이유를 CSV만 보고 알 수 있어야 한다. 없으면 매번 케이스를
                # 다시 돌려 요약을 눈으로 확인하게 된다.
                "invented_dates": " ".join(result.summary.invented_dates),
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
        return CaseResult(case.case_id, case.scenario, _ZERO_TODO, _ZERO_SUMMARY, "failed")

    try:
        summary = judge_summary(
            result.summary,
            result.decisions,
            case.golden.summary_checklist,
            judge_ask,
            source_text=_source_text_of(case.request),
        )
    except Exception:
        logger.warning("요약 심사 실패로 0점 처리. case_id=%s", case.case_id, exc_info=True)
        summary = _ZERO_SUMMARY

    return CaseResult(
        case.case_id,
        case.scenario,
        score_todos(result.todos, case.golden.todos),
        summary,
        result.analysis_provider,
    )


# 설정값과 라벨의 표기가 달라 문자열 비교만으로는 폴백을 가려낼 수 없다.
_TIER_ALIASES = {
    "hf": "huggingface",
    "rule": "rule_based",
    "auto": "huggingface",
}


def _is_requested_tier(result: CaseResult, provider: str) -> bool:
    requested = _TIER_ALIASES.get(provider, provider)
    return result.analysis_provider == requested


def _source_text_of(request: AnalyzeRequest) -> str:
    """심사기에게 넘길 회의록 원문을 만든다.

    원문이 `text`(자유 서술)와 `sections`(양식 문서) 두 자리로 나뉘어 있어 한쪽만 보면
    양식 케이스에서 원문이 통째로 비어버린다. 채워진 쪽을 모아 넘긴다.
    """
    parts = [request.text or ""]
    sections = request.sections
    if sections is not None:
        parts += [
            sections.discussion or "",
            sections.decisions or "",
            sections.todos or "",
            sections.issues or "",
        ]
    return "\n".join(part.strip() for part in parts if part and part.strip())


def _mean(values: List[float]) -> float:
    return 0.0 if not values else sum(values) / len(values)
