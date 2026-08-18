"""요약이 원문에 없는 날짜를 지어냈는지 문자열로 검사한다.

이 축을 LLM 심사기에서 떼어낸 이유는 재현되지 않아서다. 같은 요약 문장이라도 원문에
날짜와 이름이 많으면 4B 심사기가 대조 방향을 뒤집어 읽어 "아니오"를 답했다.
문구를 네 번 바꿔봤지만 짧은 합성 원문에서만 맞고 실제 케이스에서 무너졌다.
"지어낸 날짜가 있는가"는 판단이 아니라 문자열 문제라 여기서 결정적으로 답한다.
"""

from __future__ import annotations

from meeting_eval.safety_check import check_invented_dates

SOURCE = "박지수: 알림이 중복으로 갑니다.\n유소은: 8월 10일까지 원인을 정리해 문서로 남기겠습니다."


def test_summary_without_dates_is_safe():
    """대조할 값이 없으면 지어낸 것도 없다. LLM 심사기가 가장 자주 틀리던 경우다."""
    result = check_invented_dates("알림 중복 원인을 정리해 문서로 남기기로 했다.", SOURCE)

    assert result.score == 1.0
    assert result.invented_dates == []


def test_date_that_appears_in_the_source_is_safe():
    result = check_invented_dates("8월 10일까지 원인을 정리한다.", SOURCE)

    assert result.score == 1.0


def test_date_missing_from_the_source_is_flagged():
    result = check_invented_dates("8월 30일까지 원인을 정리한다.", SOURCE)

    assert result.score == 0.0
    assert result.invented_dates == ["8월 30일"]


def test_same_date_written_in_another_format_is_still_safe():
    """원문은 '8월 10일', 요약은 '8/10' 처럼 표기가 갈리는 것은 지어낸 것이 아니다."""
    result = check_invented_dates("8/10까지 원인을 정리한다.", SOURCE)

    assert result.score == 1.0


def test_iso_date_matches_a_korean_date_in_the_source():
    result = check_invented_dates("2026-08-10까지 정리한다.", SOURCE)

    assert result.score == 1.0


def test_vague_time_expression_is_not_a_date():
    """'다음 주쯤'을 특정 날짜로 바꿨는지는 케이스별 체크리스트 문항이 따로 본다."""
    result = check_invented_dates("다음 주쯤 정리하기로 했다.", SOURCE)

    assert result.score == 1.0


def test_score_is_all_or_nothing():
    """지어낸 날짜가 하나라도 있으면 그 요약은 못 쓴다. 개수로 깎지 않는다."""
    result = check_invented_dates("8월 30일과 9월 2일에 나눠 정리한다.", SOURCE)

    assert result.score == 0.0
    assert result.invented_dates == ["8월 30일", "9월 2일"]


def test_result_reports_whether_the_summary_had_any_date():
    """안전성 1.000 이 '안 지어냈다' 인지 '날짜를 안 썼다' 인지 구분할 수 있어야 한다.

    36건을 재보니 요약이 날짜를 쓴 것은 2건뿐이었다. 나머지 34건의 만점은 검사가
    통과한 것이 아니라 검사할 것이 없었던 것이다. 점수만 싣고 이 사실을 안 싣면
    변별력 없는 1.000 을 계속 성과로 읽게 된다.
    """
    silent = check_invented_dates("날짜를 쓰지 않은 요약", "8월 10일까지 끝낸다")
    spoke = check_invented_dates("8월 10일까지 끝낸다", "8월 10일까지 끝낸다")

    assert silent.score == 1.0 and not silent.dated
    assert spoke.score == 1.0 and spoke.dated
