"""요약 체크리스트가 세 평가셋에서 공통으로 지켜야 할 모양.

요약 점수는 충실도(담겼는가) × 안전성(지어내지 않았는가)이다. 충실도 문항이 통째로
빠지면 그 케이스는 무조건 0점이 되고, 그 사실이 겉으로 드러나지 않는다. 실제로
duedate-02 와 halluc-01 은 두 문항이 모두 안전성이라 충실도를 재는 문항이 하나도
없었고, 그 상태로 계속 측정되고 있었다.

안전성 쪽은 문항을 요구하지 않는다. 지어낸 날짜 찾기는 `safety_check` 가 케이스와
무관하게 항상 돌고, 체크리스트에는 케이스마다 다른 제약만 남기기 때문이다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from meeting_eval.dataset import load_cases
from meeting_eval.summary_judge import COVERAGE

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SETS = ["meeting_eval", "meeting_eval_extraction", "meeting_eval_v2"]

# 지어낸 날짜를 LLM에게 묻던 문항들. 문구를 네 번 바꿔도 원문에 날짜가 많으면 심사기가
# 대조 방향을 뒤집어 읽어 재현되지 않았다. safety_check 가 문자열로 대신 답하므로
# 이 문항이 되살아나면 못 미더운 값이 안전성 축에 다시 섞인다.
RETIRED_ITEMS = {
    "회의록 원문에 없는 날짜나 이름이 요약에 없는가",
    "요약에 적힌 날짜와 사람 이름이 모두 회의록 원문에 나오는가",
    "요약에 나오는 날짜와 사람 이름을 회의록 원문에서 모두 찾을 수 있는가",
    "요약에 등장하는 날짜가 모두 회의록 원문에 있는 날짜인가",
}


@pytest.mark.parametrize("fixture_set", SETS)
def test_every_case_measures_coverage(fixture_set):
    for case in load_cases(FIXTURES / fixture_set):
        kinds = {item.kind for item in case.golden.summary_checklist}
        assert COVERAGE in kinds, f"{fixture_set}/{case.case_id}: 충실도 문항이 없어 항상 0점이다"


@pytest.mark.parametrize("fixture_set", SETS)
def test_retired_items_stay_retired(fixture_set):
    for case in load_cases(FIXTURES / fixture_set):
        for item in case.golden.summary_checklist:
            assert item.text not in RETIRED_ITEMS, f"{fixture_set}/{case.case_id}: {item.text}"


def test_loader_rejects_a_checklist_item_without_a_kind(tmp_path):
    """유형을 빠뜨린 문항이 조용히 충실도로 세어지면 안전성 문항이 사라진 것을 아무도 모른다."""
    (tmp_path / "case.json").write_text(
        '{"case_id": "x", "scenario": "y", "input": {"text": "z"},'
        ' "golden": {"todos": [], "summary_checklist": [{"item": "담겼는가"}]}}',
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="kind"):
        load_cases(tmp_path)
