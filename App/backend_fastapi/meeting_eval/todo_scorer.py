"""정답 To-Do와 예측 To-Do를 대조해 점수를 낸다.

LLM 심사를 쓰지 않는다. To-Do는 필드가 구조화돼 있어 기계적으로 대조할 수 있고,
그래야 같은 입력에 항상 같은 점수가 나와 개선 효과를 증명할 수 있다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from app.main import MeetingTodo
from meeting_eval.dataset import GoldenTodo

_TITLE_OVERLAP_THRESHOLD = 0.5
_TOKEN_PATTERN = re.compile(r"[가-힣A-Za-z0-9]+")


@dataclass(frozen=True)
class TodoScore:
    precision: float
    recall: float
    f1: float
    assignee_accuracy: float
    due_date_accuracy: float
    priority_accuracy: float
    matched: int
    # 근거 문장이 비어 제목 겹침으로 붙인 건수. 높으면 근거 품질 자체가 나쁘다는 신호다.
    fallback_matched: int
    predicted_count: int
    golden_count: int


def score_todos(predicted: Sequence[MeetingTodo], golden: Sequence[GoldenTodo]) -> TodoScore:
    pairs, fallback_matched = _match(predicted, golden)
    matched = len(pairs)

    if not golden:
        # 뽑을 할 일이 없는 회의. 아무것도 만들지 않으면 만점, 하나라도 지어내면 0점이다.
        # 두 경우를 구분하지 못하면 "환각을 안 했다"는 것을 점수로 증명할 수 없다.
        precision = 1.0 if not predicted else 0.0
        recall = 1.0
    else:
        precision = _ratio(matched, len(predicted))
        recall = _ratio(matched, len(golden))
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)

    return TodoScore(
        precision=precision,
        recall=recall,
        f1=f1,
        # 정답이 0건이면 틀릴 필드 자체가 없다. 이때 필드 정확도를 0으로 두면 정답을 맞힌
        # 케이스가 평균을 끌어내린다. 지어내지 않았으면 1.0, 지어냈으면 0.0 으로 precision 을 따른다.
        assignee_accuracy=(
            precision if not golden
            else _field_accuracy(pairs, lambda p, g: p.assignee_candidate == g.assignee)
        ),
        due_date_accuracy=(
            precision if not golden
            else _field_accuracy(pairs, lambda p, g: p.due_date == g.due_date)
        ),
        priority_accuracy=(
            precision if not golden
            else _field_accuracy(pairs, lambda p, g: p.priority == g.priority)
        ),
        matched=matched,
        fallback_matched=fallback_matched,
        predicted_count=len(predicted),
        golden_count=len(golden),
    )


def _match(
    predicted: Sequence[MeetingTodo], golden: Sequence[GoldenTodo]
) -> Tuple[List[Tuple[MeetingTodo, GoldenTodo]], int]:
    used: set[int] = set()
    pairs: List[Tuple[MeetingTodo, GoldenTodo]] = []
    fallback_matched = 0

    for gold in golden:
        index = _find_by_evidence(predicted, gold, used)
        if index is None:
            index = _find_by_title(predicted, gold, used)
            if index is not None:
                fallback_matched += 1
        if index is None:
            continue
        used.add(index)
        pairs.append((predicted[index], gold))

    return pairs, fallback_matched


def _find_by_evidence(predicted, gold: GoldenTodo, used: set) -> Optional[int]:
    snippet = _normalize(gold.evidence_snippet)
    if not snippet:
        return None
    for index, item in enumerate(predicted):
        if index in used:
            continue
        if snippet in _normalize(item.evidence_text or ""):
            return index
    return None


def _find_by_title(predicted, gold: GoldenTodo, used: set) -> Optional[int]:
    """근거 문장이 비었을 때만 쓰는 폴백. 근거 없는 예측을 무조건 오답 처리하면
    To-Do 추출 능력이 아니라 근거 품질을 재게 된다."""
    gold_tokens = _tokens(gold.title)
    if not gold_tokens:
        return None
    for index, item in enumerate(predicted):
        if index in used or (item.evidence_text or "").strip():
            continue
        overlap = len(gold_tokens & _tokens(item.title)) / len(gold_tokens)
        if overlap >= _TITLE_OVERLAP_THRESHOLD:
            return index
    return None


def _field_accuracy(pairs, predicate) -> float:
    if not pairs:
        return 0.0
    return sum(1 for predicted, gold in pairs if predicate(predicted, gold)) / len(pairs)


def _ratio(numerator: int, denominator: int) -> float:
    return 0.0 if denominator == 0 else numerator / denominator


def _normalize(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _tokens(value: str) -> set:
    return set(_TOKEN_PATTERN.findall(value))
