"""집계를 읽어 보여주는 스크립트.

읽는 쪽에 테스트를 붙이는 이유: 이 관측은 **읽히지 않으면 만든 이유가 없다.**
`assistant_messages` 테이블이 정의만 있고 아무도 읽지 않아 삭제된 전례가 있다.

특히 비율 계산은 눈으로 검산하기 어렵다. 분모를 잘못 잡으면(예: 개인화 질문까지
코드 분포의 분모에 넣으면) 숫자는 그럴듯한데 결론이 틀린다.
"""

from __future__ import annotations

import importlib.util
from collections import Counter
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "show_rag_stats.py"


@pytest.fixture(scope="module")
def script():
    spec = importlib.util.spec_from_file_location("show_rag_stats", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_empty_period_says_so_instead_of_printing_zeros(script):
    """0으로 가득한 표를 보여주면 '질의가 없었다'와 '스크립트가 잘못 붙었다'를 구분 못 한다."""
    output = script._render(Counter(), [], days=14)

    assert "기록된 질의가 없습니다" in output


def test_code_ratio_uses_routed_questions_as_the_denominator(script):
    """개인화 질문은 라우팅을 타지 않으므로 코드 분포의 분모에서 빠져야 한다.

    넣으면 '코드 질문 비중'이 실제보다 낮게 나와, 라우팅 투자가 헛돈 것처럼 보인다.
    """
    totals = Counter({"total": 10, "personal": 6, "codes_0": 1, "codes_1": 3})

    output = script._render(totals, ["2026-08-02"], days=7)

    # 라우팅 대상 4건 중 코드가 든 것이 3건 = 75.0%
    assert "75.0%" in output
    assert "라우팅 대상" in output


def test_the_demo_project_is_flagged(script):
    """project 1 은 테스트 주입 데이터가 섞여 있다. 표시가 없으면 비율을 실사용으로 오독한다."""
    totals = Counter({"total": 4, "codes_0": 4, "proj_1": 3, "proj_9": 1})

    output = script._render(totals, ["2026-08-02"], days=7)

    assert "(데모)" in output


def test_unknown_fields_are_surfaced_not_swallowed(script):
    """코드가 새 카운터를 쓰기 시작했는데 이 스크립트를 안 고치면, 새로 만든 관측이
    또 안 보이게 된다 - 이 프로젝트가 이미 두 번 겪은 실패다."""
    totals = Counter({"total": 1, "codes_0": 1, "codes_rewritten": 1})

    output = script._render(totals, ["2026-08-02"], days=7)

    assert "모르는 필드: codes_rewritten" in output


def test_a_known_field_is_never_reported_as_unknown(script):
    totals = Counter({"total": 1, "codes_2": 1, "code_miss": 1, "sources_short": 1, "proj_3": 1})

    output = script._render(totals, ["2026-08-02"], days=7)

    assert "모르는 필드" not in output


def test_id_reference_counters_are_rendered(script) -> None:
    """id 지칭이 집계에 잡혀도 스크립트가 모르면 '모르는 필드'로 밀려 눈에 안 띈다."""
    totals = Counter({"total": 10, "codes_0": 8, "ids_referenced": 6, "id_miss": 1, "proj_1": 10})

    output = script._render(totals, ["2026-08-03"], days=1)

    assert "ids_referenced" in output
    assert "id_miss" in output
    assert "이 스크립트가 모르는 필드" not in output


def test_id_flags_are_measured_against_routed_questions(script) -> None:
    """분모가 total 이면 개인화 질문이 섞여 비율이 실제보다 낮게 보인다."""
    totals = Counter({"total": 10, "personal": 5, "codes_0": 5, "ids_referenced": 5, "proj_1": 10})

    output = script._render(totals, ["2026-08-03"], days=1)

    # 라우팅 대상 5건 중 5건 -> 100%. total 10 으로 나누면 50% 로 보인다.
    ids_line = next(line for line in output.splitlines() if "ids_referenced" in line)
    assert "100.0%" in ids_line
