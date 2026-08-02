"""질의 집계 카운터.

## 무엇을 지키는 테스트인가

이 관측을 만든 이유가 "라우팅의 효과를 모른다"라서, 카운터가 **틀린 조건에 오르면
관측이 없는 것보다 나쁘다.** 없으면 모른다는 걸 알지만, 틀리면 틀린 결론을 내린다.
그래서 필드별 증가 조건을 하나씩 못 박는다.

동시에 통계가 **질의를 죽이지 않는 것**도 지킨다. 부수적인 계측이 본 기능을 실패시키면
그건 관측이 아니라 신규 장애 지점이다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytest

from llm_rag_assistant.app.services import rag_stats
from llm_rag_assistant.app.services.rag_stats import (
    QuestionQueryStats,
    _counter_fields,
    _stats_key,
    record_question_query,
)


def _stats(**overrides) -> QuestionQueryStats:
    base = {"project_id": 7, "top_k": 5, "personal": False, "source_count": 5}
    return QuestionQueryStats(**{**base, **overrides})


def test_every_question_counts_toward_total_and_its_project():
    """프로젝트 분포가 없으면 '코드 질문 30%'가 실사용인지 데모 조작인지 구분할 수 없다.

    project_id=1 은 테스트 주입 데이터가 섞인 데모다.
    """
    fields = _counter_fields(_stats(project_id=1))

    assert fields["total"] == 1
    assert fields["proj_1"] == 1


def test_personal_questions_are_counted_but_get_no_code_fields():
    """개인화 질문은 라우팅을 타지 않으므로 코드 필드의 분모에 들어가면 안 된다.

    들어가면 '코드 질문 비중'이 라우팅이 닿지도 않는 경로까지 포함해 낮게 나온다.
    """
    fields = _counter_fields(_stats(personal=True, code_count=2))

    assert fields["personal"] == 1
    assert not [name for name in fields if name.startswith("codes_")]
    assert "code_miss" not in fields


@pytest.mark.parametrize(
    ("code_count", "expected"),
    [(0, "codes_0"), (1, "codes_1"), (4, "codes_4"), (5, "codes_5plus"), (9, "codes_5plus")],
)
def test_code_count_lands_in_the_right_bucket(code_count: int, expected: str):
    """5개 이상을 한 칸에 모으는 이유: top_k 가 5라 그 이상은 어차피 잘려 결정에 안 쓰인다."""
    fields = _counter_fields(_stats(code_count=code_count, code_slots=code_count))

    assert fields[expected] == 1


def test_truncation_is_counted_when_codes_outnumber_their_slots():
    """이 값이 top_k 상한을 올릴 이유가 되는지를 결정한다."""
    fields = _counter_fields(_stats(code_count=7, code_slots=5))

    assert fields["codes_truncated"] == 1


def test_no_truncation_when_every_code_got_a_slot():
    fields = _counter_fields(_stats(code_count=4, code_slots=4))

    assert "codes_truncated" not in fields


def test_code_miss_is_counted_when_the_code_matched_nothing():
    """없는 코드를 말했거나 색인이 빠진 경우. 폴백 경로의 크기를 본다."""
    fields = _counter_fields(_stats(code_count=2, code_slots=3, code_hits=0))

    assert fields["code_miss"] == 1


def test_a_failed_code_search_is_not_counted_as_a_miss():
    """'코드가 정말 없음'과 '조회 실패'를 한 칸에 담으면 관측값이 오염된다.

    같은 이유로 실패 경로에서는 라우팅 info 로그도 남기지 않는다(retrieval_service).
    """
    fields = _counter_fields(
        _stats(code_count=2, code_slots=3, code_hits=0, code_search_failed=True)
    )

    assert "code_miss" not in fields


def test_short_evidence_is_counted():
    """중복 제거를 넣고도 근거가 top_k 에 못 미치는 비율을 본다."""
    fields = _counter_fields(_stats(source_count=3, top_k=5))

    assert fields["sources_short"] == 1


def test_full_evidence_is_not_counted_as_short():
    fields = _counter_fields(_stats(source_count=5, top_k=5))

    assert "sources_short" not in fields


def test_stats_key_uses_utc_not_the_server_timezone():
    """서버 타임존 설정에 흔들리면 날짜가 재배포마다 바뀔 수 있다.

    KST 와 9시간 차이가 난다는 점은 읽는 쪽(show_rag_stats.py)과 문서에 함께 적혀 있다.
    """
    kst_midnight_edge = datetime(2026, 8, 2, 16, 30, tzinfo=timezone.utc)

    assert _stats_key(kst_midnight_edge) == "rag_stats:2026-08-02"


@pytest.mark.asyncio
async def test_counters_and_ttl_land_in_redis(rag_stats_redis):
    await record_question_query(_stats(project_id=3, code_count=1, code_slots=3, code_hits=1))

    key = _stats_key()
    assert rag_stats_redis.hashes[key] == {"total": 1, "proj_3": 1, "codes_1": 1}
    # TTL 이 빠지면 키가 영원히 남는다. 90일.
    assert rag_stats_redis.expirations[key] == 90 * 24 * 60 * 60


@pytest.mark.asyncio
async def test_repeated_questions_accumulate(rag_stats_redis):
    await record_question_query(_stats(project_id=3))
    await record_question_query(_stats(project_id=3))

    assert rag_stats_redis.hashes[_stats_key()]["total"] == 2


@pytest.mark.asyncio
async def test_a_broken_redis_never_fails_the_query(monkeypatch, caplog):
    """통계가 답변을 죽이면 그건 관측이 아니라 새로 만든 장애 지점이다.

    advance_rag_project_epoch 와 같은 정책이다.
    """
    def _explode():
        raise RuntimeError("redis down")

    monkeypatch.setattr(rag_stats, "get_async_redis_client", _explode)

    with caplog.at_level(logging.WARNING):
        await record_question_query(_stats())  # 예외가 나가면 이 줄에서 테스트가 깨진다

    assert "질의 통계 기록 실패" in caplog.text
