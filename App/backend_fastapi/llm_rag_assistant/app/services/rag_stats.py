"""어시스턴트 질의 집계 카운터.

## 왜 있는가

라우팅과 중복 제거를 넣었지만 **효과를 모른다.** 코드가 든 질문이 실사용에서 몇 %인지
모르므로 다음 투자처를 정할 수 없다. 설계와 답해야 할 다섯 질문은
docs/decisions/2026-08-01-assistant-query-observability.md 에 있다.

## 왜 로그가 아니라 Redis 인가

운영 컨테이너 로그는 **재배포마다 초기화된다**(로그 수집 인프라 없음, 배포는 하루 여러 번).
축적이 목적이므로 로그로는 안 된다. Redis 는 `appendonly yes` + `/data` 볼륨이라 살아남고,
스키마 변경이 없어 마이그레이션·승인 게이트 없이 바로 쌓기 시작할 수 있다.

## 왜 이 모듈로 떼어냈나

Redis 세부와 실패 처리를 한 곳에 가둔다. 그래야 retrieval_service 가 캐시 인프라를 직접
알지 않고, 집계 필드 계산(_counter_fields)을 Redis 없이 단위 테스트할 수 있다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from core.cache import get_async_redis_client

logger = logging.getLogger(__name__)

# 우선순위를 정하기 위한 몇 주짜리 측정이지 영구 텔레메트리가 아니다. 90일이면 계절성 없이
# 판단하기에 충분하고, 잊고 방치해도 스스로 사라진다.
_TTL_SECONDS = 90 * 24 * 60 * 60

# 코드 개수 버킷의 상한. 이 값 이상은 codes_5plus 한 칸에 모은다. top_k 기본값이 5라
# 5개를 넘게 나열하면 어차피 잘리므로, 그 이상은 개수를 세도 결정에 쓰이지 않는다.
_CODE_BUCKET_CAP = 5


@dataclass(frozen=True)
class QuestionQueryStats:
    """질문 한 건에서 관측한 값. 집계에 필요한 수치만 담는다.

    질문 원문도 코드 값도 담지 않는다 - 다섯 질문이 전부 집계라 원문이 필요 없고,
    담지 않으면 개인정보 문제가 설계에서 통째로 사라진다.
    """

    project_id: int
    top_k: int
    personal: bool
    source_count: int
    code_count: int = 0
    code_hits: int = 0
    code_slots: int = 0
    # 코드 검색이 예외로 실패한 경우. code_hits 가 0 이어도 "코드가 정말 없음"이 아니므로
    # code_miss 로 세면 안 된다. 두 가지를 한 칸에 담으면 관측값이 오염된다.
    code_search_failed: bool = False


def _code_bucket(code_count: int) -> str:
    if code_count >= _CODE_BUCKET_CAP:
        return f"codes_{_CODE_BUCKET_CAP}plus"
    return f"codes_{code_count}"


def _counter_fields(stats: QuestionQueryStats) -> dict[str, int]:
    """올릴 필드 목록. 순수 함수라 Redis 없이 조건을 검증할 수 있다."""
    fields = {"total": 1, f"proj_{stats.project_id}": 1}

    if stats.personal:
        # 개인화 질문에는 라우팅을 걸지 않으므로(retrieval_service 참고) 코드 관련 필드를
        # 올리지 않는다. 올리면 "코드 질문 비중" 분모가 라우팅 미적용 경로까지 포함하게 된다.
        fields["personal"] = 1
    else:
        fields[_code_bucket(stats.code_count)] = 1
        if stats.code_count > stats.code_slots:
            fields["codes_truncated"] = 1
        if stats.code_count > 0 and not stats.code_search_failed and stats.code_hits == 0:
            fields["code_miss"] = 1

    if stats.source_count < stats.top_k:
        fields["sources_short"] = 1

    return fields


def _stats_key(now: datetime | None = None) -> str:
    """rag_stats:{YYYY-MM-DD}. 날짜는 UTC 기준이다.

    서버 타임존 설정에 흔들리지 않기 위해서다. 해석할 때 KST 와 9시간 차이가 나므로
    KST 자정 전후 질의는 다른 날로 잡힌다(show_rag_stats.py 도 같은 기준으로 읽는다).
    """
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    return f"rag_stats:{stamp}"


async def record_question_query(stats: QuestionQueryStats) -> None:
    """질문 한 건을 집계한다. **어떤 경우에도 질의를 실패시키지 않는다.**

    advance_rag_project_epoch 가 이미 같은 정책이다("캐시는 DB 원본의 파생물이므로 무효화
    실패가 원본 변경 API를 실패시켜서는 안 된다"). 통계는 그보다도 부수적이다.
    """
    key = _stats_key()
    try:
        # transaction=False 는 필수다. redis-py 기본값(True)은 MULTI/EXEC 로 감싸는데
        # fastapi ACL 계정에는 그 두 명령이 없어 통째로 NOPERM 이 된다. 원자성도 필요 없다 -
        # 필드마다 독립적인 HINCRBY 이고, 부분 실패해도 다음 질의가 이어서 센다.
        pipe = get_async_redis_client().pipeline(transaction=False)
        for field, amount in _counter_fields(stats).items():
            pipe.hincrby(key, field, amount)
        # 매번 다시 건다. 키가 만들어진 날이 아니라 마지막으로 쓰인 날부터 90일이 되지만,
        # 일별 키라 그 차이는 하루뿐이고 TTL 이 빠지는 사고를 원천 차단하는 편이 낫다.
        pipe.expire(key, _TTL_SECONDS)
        await pipe.execute()
    except Exception:
        logger.warning("질의 통계 기록 실패, 집계만 누락되고 답변은 정상 진행합니다.", exc_info=True)
