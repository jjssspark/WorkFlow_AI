"""요약이 회의록에 없는 날짜를 지어냈는지 문자열로 검사한다.

이 축은 원래 LLM 심사기가 문답으로 재던 것인데 재현되지 않아 떼어냈다. 같은 요약
문장이라도 원문에 날짜와 이름이 많으면 4B 심사기가 대조 방향을 뒤집어 읽어 "아니오"를
답했다("원문엔 있는데 요약엔 없네"). 문구를 네 번 바꿔봤지만 짧은 합성 원문에서만 맞고
실제 케이스에서 무너졌다.

"지어낸 날짜가 있는가"는 판단이 아니라 문자열 대조다. 여기서 결정적으로 답한다.
판단이 필요한 충실도("이 내용이 담겼는가")만 LLM 심사기에 남긴다.

**사람 이름은 일부러 재지 않는다.** 성씨 패턴으로 요약에서 이름을 뽑아보니 "남기기",
"문서로", "정리해"가 이름으로 잡혔다. 형태소 분석 없이 한국어에서 미지의 이름을 가려낼
방법이 없다. 담당자 환각이라는 실제 위험은 구조화된 필드를 대조하는
`todo_scorer` 의 `assignee_accuracy` 가 이미 정확히 재고 있어, 여기서 못 미더운 값을
하나 더 만들지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Set, Tuple

# 평가셋 회의록이 실제로 쓰는 날짜 표기. 연도는 버리고 (월, 일)로만 맞춘다 - 합성 회의록이
# 모두 한 해 안이고, 요약이 연도를 생략해 적는 것은 지어낸 것이 아니기 때문이다.
_DATE_PATTERNS = [
    re.compile(r"\d{4}[-./](\d{1,2})[-./](\d{1,2})"),
    re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일"),
    re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})(?!\d)"),
]

# "8.10" 같은 마침표 표기는 일부러 뺐다. 버전 번호나 소수와 구분되지 않아 오탐이
# 이득보다 크다. 평가셋 회의록에도 이 표기는 쓰이지 않는다.


@dataclass(frozen=True)
class SafetyResult:
    score: float
    invented_dates: List[str]


def check_invented_dates(summary: str, source_text: str) -> SafetyResult:
    """요약에만 있고 회의록에는 없는 날짜를 찾는다."""
    source_dates = {normalized for normalized, _ in _dates_in(source_text)}
    invented = _unique(
        surface for normalized, surface in _dates_in(summary) if normalized not in source_dates
    )

    # 지어낸 날짜가 하나라도 있으면 그 요약은 못 쓴다. 개수로 깎으면 "많이 쓰고 몇 개만
    # 지어낸" 요약이 "조금 쓰고 하나 지어낸" 요약보다 높게 나온다.
    return SafetyResult(score=0.0 if invented else 1.0, invented_dates=invented)


def _dates_in(text: str) -> List[Tuple[Tuple[int, int], str]]:
    """(정규화된 (월, 일), 적힌 그대로) 목록. 표기가 달라도 같은 날이면 같은 값이다."""
    found: List[Tuple[Tuple[int, int], str]] = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text):
            month, day = int(match.group(1)), int(match.group(2))
            if 1 <= month <= 12 and 1 <= day <= 31:
                found.append(((month, day), match.group(0)))
    return found


def _unique(values) -> List[str]:
    seen: Set[str] = set()
    return [value for value in values if not (value in seen or seen.add(value))]
