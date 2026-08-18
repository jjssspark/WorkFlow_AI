"""요약·결정사항을 체크리스트로 심사한다.

요약은 정답이 하나가 아니라 문자열 대조가 불가능하다. 대신 케이스마다 "이건 담겼어야
한다" / "이건 없어야 한다"를 체크리스트로 적어두고 항목별 예·아니오만 받는다.
항목을 한 번에 몰아 물으면 응답 형식이 흔들려서 하나씩 묻는다.

**두 종류의 문항을 평균하지 않는다.** 충실도(담겼는가)와 안전성(지어내지 않았는가)은
실패 방향이 반대라 평균하면 서로를 가려준다. 케이스마다 문항이 반반이던 예전 방식에서는
아무 말도 안 한 요약이 안전성을 거저 통과해 바닥값이 0.5였고, 날짜와 이름을 아예 쓰지
않는 규칙 기반 요약이 측정에서 1위(0.792)를 했다. 지금은 두 축을 따로 세고 곱한다.

**지어낸 날짜를 찾는 일은 LLM에게 맡기지 않는다.** 그 문항은 원문에 날짜가 많으면
심사기가 대조 방향을 뒤집어 읽어 재현되지 않았다. `safety_check` 가 문자열로 답하고,
케이스마다 다른 제약만 체크리스트 문항으로 남긴다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, NamedTuple, Sequence, Union

from meeting_eval.safety_check import check_invented_dates

COVERAGE = "coverage"
SAFETY = "safety"

_AFFIRMATIVE = {"예", "yes", "true", "y"}


class ChecklistItem(NamedTuple):
    """심사 문항 하나. 두 축 중 어느 쪽을 재는지 문항 자신이 들고 있어야 한다.

    문면만 보고는 갈라낼 수 없다. "특정 날짜로 지어내지지 않고 미확정으로 남는가"는
    담겼는지를 묻는 것처럼 읽히지만 실제로는 안전성 문항이다.
    """

    text: str
    kind: str = COVERAGE


@dataclass(frozen=True)
class JudgeVerdict:
    checklist_item: str
    passed: bool
    kind: str = COVERAGE


@dataclass(frozen=True)
class SummaryScore:
    verdicts: List[JudgeVerdict]
    score: float
    coverage: float = 0.0
    safety: float = 1.0
    invented_dates: List[str] = field(default_factory=list)


def judge_summary(
    summary: str,
    decisions: Sequence[str],
    checklist: Sequence[Union[ChecklistItem, str]],
    ask: Callable[[str], str],
    source_text: str = "",
) -> SummaryScore:
    # 문항 유형은 픽스처가 명시한다(dataset.py 가 누락을 거부한다). 여기서 맨 문자열을
    # 받아주는 것은 단위 테스트에서 유형이 관심사가 아닐 때를 위한 것이다.
    items = [item if isinstance(item, ChecklistItem) else ChecklistItem(item) for item in checklist]

    verdicts = [
        JudgeVerdict(
            checklist_item=item.text,
            passed=_is_affirmative(
                ask(_build_prompt(summary, decisions, item, source_text))
            ),
            kind=item.kind,
        )
        for item in items
    ]

    # 충실도가 없으면 0.0, 안전성이 없으면 1.0 - 기본값이 서로 다른 데는 이유가 있다.
    # 잰 것이 없으면 점수를 줄 근거가 없지만(충실도), 걸어둔 제약이 없으면 어긴 것도
    # 없다(안전성). 반대로 두면 문항을 빠뜨린 케이스가 조용히 만점을 받는다.
    coverage = _ratio(verdicts, COVERAGE, default=0.0)

    # 안전성은 두 검사를 곱한다. 지어낸 날짜가 있는지는 문자열로 결정적으로 보고
    # (safety_check), 케이스마다 다른 제약("'다음 주쯤'이 특정 날짜로 바뀌지 않았는가")은
    # 판단이 필요해 체크리스트 문항으로 남긴다. 문항이 하나도 없으면 규칙 검사가 전부다.
    invented = check_invented_dates(summary, source_text)
    safety = invented.score * _ratio(verdicts, SAFETY, default=1.0)

    return SummaryScore(
        verdicts=verdicts,
        score=coverage * safety,
        coverage=coverage,
        safety=safety,
        invented_dates=invented.invented_dates,
    )


def _ratio(verdicts: Sequence[JudgeVerdict], kind: str, default: float) -> float:
    selected = [verdict for verdict in verdicts if verdict.kind == kind]
    if not selected:
        return default
    return sum(1 for verdict in selected if verdict.passed) / len(selected)


def _build_prompt(
    summary: str, decisions: Sequence[str], item: ChecklistItem, source_text: str = ""
) -> str:
    """축마다 심사기에게 보여주는 것이 다르다.

    충실도 문항에는 요약문만 넘긴다. 원문과 결정사항은 요약이 비어 있어도 늘 채워져
    있어서, 같이 넘기면 심사기가 요약 대신 그쪽을 읽고 답한다. 결정사항만 뺐을 때
    규칙 기반 many-01 이 0.29 -> 0.86 으로 뛰었는데 요약은 그대로 기계 문구였다.
    문항이 "무엇이 담겼어야 하는지"를 문면에 적고 있으므로 원문 없이 답할 수 있다.

    안전성 문항에는 원문과 결정사항을 함께 넘긴다. "요약에 적힌 날짜가 모두 원문에
    나오는가" 형태라 원문 없이는 대조할 대상이 없어 원리상 답할 수 없다. 원문 없이
    측정했을 때 1.5B와 4B 모델이 정확히 이 문항에서만 반복해서 틀린 것이 그 증거다.
    결정사항에 섞인 지어낸 날짜도 사용자에게 나가므로 심사 대상에서 빼면 안 된다.
    """
    if item.kind != SAFETY:
        return (
            "아래 회의 요약을 읽고 질문에 '예' 또는 '아니오' 한 단어로만 답하세요.\n"
            "요약에 적힌 내용만 근거로 삼고, 요약에 없으면 '아니오'라고 답하세요.\n\n"
            f"[요약]\n{summary}\n\n"
            f"[질문]\n{item.text}"
        )

    source_block = f"[회의록 원문]\n{source_text}\n\n" if source_text.strip() else ""
    decision_lines = "\n".join(f"- {decision}" for decision in decisions) or "(없음)"
    return (
        "아래 회의록 원문과 요약, 결정사항을 읽고 질문에 '예' 또는 '아니오' 한 단어로만 답하세요.\n\n"
        f"{source_block}"
        f"[요약]\n{summary}\n\n"
        f"[결정사항]\n{decision_lines}\n\n"
        f"[질문]\n{item.text}"
    )


def _is_affirmative(answer: str) -> bool:
    """'예'/'아니오' 외의 응답은 실패로 센다. 판단을 못 한 응답을 통과로 세면
    심사기가 점수를 부풀린다."""
    return answer.strip().strip(".!").lower() in _AFFIRMATIVE
