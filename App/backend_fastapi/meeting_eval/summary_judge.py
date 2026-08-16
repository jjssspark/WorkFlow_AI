"""요약·결정사항을 체크리스트로 심사한다.

요약은 정답이 하나가 아니라 문자열 대조가 불가능하다. 대신 케이스마다 "이건 담겼어야
한다" / "이건 없어야 한다"를 체크리스트로 적어두고 항목별 예·아니오만 받는다.
항목을 한 번에 몰아 물으면 응답 형식이 흔들려서 하나씩 묻는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Sequence

_AFFIRMATIVE = {"예", "yes", "true", "y"}


@dataclass(frozen=True)
class JudgeVerdict:
    checklist_item: str
    passed: bool


@dataclass(frozen=True)
class SummaryScore:
    verdicts: List[JudgeVerdict]
    score: float


def judge_summary(
    summary: str,
    decisions: Sequence[str],
    checklist: Sequence[str],
    ask: Callable[[str], str],
    source_text: str = "",
) -> SummaryScore:
    verdicts = [
        JudgeVerdict(
            checklist_item=item,
            passed=_is_affirmative(ask(_build_prompt(summary, decisions, item, source_text))),
        )
        for item in checklist
    ]
    if not verdicts:
        return SummaryScore(verdicts=[], score=0.0)
    return SummaryScore(
        verdicts=verdicts,
        score=sum(1 for verdict in verdicts if verdict.passed) / len(verdicts),
    )


def _build_prompt(summary: str, decisions: Sequence[str], item: str, source_text: str = "") -> str:
    """원문이 있으면 함께 넘긴다.

    체크리스트의 절반이 "회의록 원문에 없는 날짜나 이름이 요약에 없는가" 형태인데,
    원문 없이는 심사기가 대조할 대상이 없어 원리상 답할 수 없다. 원문 없이 측정했을 때
    1.5B와 4B 모델이 정확히 이 문항에서만 반복해서 틀린 것이 그 증거다.
    """
    decision_lines = "\n".join(f"- {decision}" for decision in decisions) or "(없음)"
    source_block = f"[회의록 원문]\n{source_text}\n\n" if source_text.strip() else ""
    return (
        "아래 회의록 원문과 요약, 결정사항을 읽고 질문에 '예' 또는 '아니오' 한 단어로만 답하세요.\n\n"
        f"{source_block}"
        f"[요약]\n{summary}\n\n"
        f"[결정사항]\n{decision_lines}\n\n"
        f"[질문]\n{item}"
    )


def _is_affirmative(answer: str) -> bool:
    """'예'/'아니오' 외의 응답은 실패로 센다. 판단을 못 한 응답을 통과로 세면
    심사기가 점수를 부풀린다."""
    return answer.strip().strip(".!").lower() in _AFFIRMATIVE
