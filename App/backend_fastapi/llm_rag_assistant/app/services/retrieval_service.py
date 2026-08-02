from __future__ import annotations

import logging
import re

from llm_rag_assistant.app.services.rag_stats import QuestionQueryStats, record_question_query
from llm_rag_assistant.app.services.vector_utils import to_vector_literal

logger = logging.getLogger(__name__)

_SEARCH_SQL = """
SELECT source_type, source_id, content,
       1 - (embedding <=> $1::vector) AS similarity
FROM document_chunks
WHERE project_id = $2
ORDER BY embedding <=> $1::vector
LIMIT $3
"""

_SEARCH_BY_TYPE_SQL = """
SELECT source_type, source_id, content,
       1 - (embedding <=> $1::vector) AS similarity
FROM document_chunks
WHERE project_id = $2 AND source_type = $3
ORDER BY embedding <=> $1::vector
LIMIT $4
"""

_SEARCH_BY_ASSIGNEE_SQL = """
SELECT source_type, source_id, content,
       1 - (embedding <=> $1::vector) AS similarity
FROM document_chunks
WHERE project_id = $2 AND assignee_id = $3
ORDER BY embedding <=> $1::vector
LIMIT $4
"""

# 업무 코드(WF-195 등)는 별도 컬럼이 아니라 content 본문 토큰이다. 임베딩 유사도로는
# 제목이 비슷한 다른 업무에 밀려 정확히 못 잡으므로, 코드가 명시되면 본문에서 그 토큰을
# 단어 경계로 정확히 찾는다. 앞뒤 경계를 모두 [^0-9A-Za-z]로 잡아 WF-195가 WF-1950이나
# WF-195A 같은 더 긴 코드에 걸리지 않게 한다(뒤 경계가 [^0-9]면 WF-195A가 오매칭된다).
_SEARCH_BY_TASK_CODE_SQL = """
SELECT source_type, source_id, content
FROM document_chunks
WHERE project_id = $1 AND source_type = 'task'
  AND content ~* ('(^|[^0-9A-Za-z])' || $2 || '([^0-9A-Za-z]|$)')
LIMIT $3
"""

# 질문 경로 전용. 위 SQL과 조건은 같고 두 가지가 다르다.
#   1. similarity 를 함께 뽑는다 - 질문 경로는 이 값을 출처 목록에 그대로 표시하므로
#      1.0 같은 가짜 값을 넣을 수 없다. 명령 경로(task_resolver)는 임베딩을 갖고 있지
#      않아 $1 을 채울 수 없어서 위 SQL 을 그대로 둔다.
#   2. 코드 여러 개를 배열로 받아 한 번의 왕복으로 끝낸다. 상한(LIMIT)은 코드별이 아니라
#      결과 집합 전체에 걸리고, 잘릴 때 무엇이 남을지는 ORDER BY 가 정한다.
_SEARCH_BY_TASK_CODES_SCORED_SQL = """
SELECT source_type, source_id, content,
       1 - (embedding <=> $1::vector) AS similarity
FROM document_chunks
WHERE project_id = $2 AND source_type = 'task'
  AND content ~* ANY($3::text[])
ORDER BY embedding <=> $1::vector
LIMIT $4
"""

# "WF-195", "FS-6" 같은 명시적 업무 코드. 있으면 임베딩보다 이 토큰의 정확 일치를 우선한다.
# 앞뒤 경계(lookaround)로 더 긴 코드의 일부를 잘라내지 않게 한다: "WF-195A"에서 "WF-195"를
# 추출하면 실제로는 다른 업무를 지칭한 것을 WF-195로 오인한다. 질문 경로에서는 엉뚱한 근거를
# 주는 데 그치지만, 명령 경로(graph/task_resolver)에서는 엉뚱한 업무를 실제로 변경한다.
# 두 경로가 같은 것을 인식해야 하므로 여기 한 곳에만 둔다.
TASK_CODE_PATTERN = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{2,}-\d+(?![A-Za-z0-9])")

# 코드 정확 일치에 내줄 최소 슬롯 수. 운영 실측상 코드 101종 중 100종이 청크 1건에만
# 매칭되므로, 코드가 하나일 때 이 값은 "한 업무가 여러 청크로 쪼개진 경우"를 담는 여유다.
# 상한이 아니라 하한이다 - 코드를 이보다 많이 말하면 말한 만큼 늘어난다(_code_slots_for).
TASK_CODE_MAX_SLOTS = 3

# 공정 배분에 쓸 후보를 넉넉히 받아오기 위한 상한. 슬롯 수만큼만 받아오면 한 코드가 전부
# 가져가 다른 코드가 후보에조차 못 오른다(운영 실측: "FS-4 와 WF-174 와 WF-175" 질문에서
# FS-4 가 3칸 중 2칸을 먹고 WF-174 가 통째로 누락됐다). 444행 순차 스캔이 1ms 미만이라
# 넉넉히 받아 파이썬에서 고르는 편이 싸다.
_TASK_CODE_FETCH_CAP = 30

# 같은 내용이 서로 다른 source_id 로 여러 벌 색인돼 있다. 운영 project 1 기준 378청크 중
# 잉여가 109건(28.8%)이고, 원인은 같은 회의록을 서로 다른 회의로 반복 업로드한 것이다
# (회의별 분석 실행 수는 전부 1회 - 색인·분석·청킹 어디에도 결함이 없다).
#
# 원인이 코드 밖에 있어도 검색은 방어해야 한다. 그대로 두면 상위 5칸을 같은 문장이 채워
# 사용자가 받는 근거가 줄어든다 - 실측상 30문항 중 10문항(33%)이 걸리고, 최악은 5칸 중
# 고유가 3개뿐이었다. 재업로드는 운영에서도 정상적으로 일어난다(같은 정기회의 반복 등).
#
# 넉넉히 받아 파이썬에서 걸러낸다. 444행 순차 스캔이 1ms 미만이라 SQL 로 DISTINCT ON 을
# 짜는 것보다 싸고, 유사도 정렬을 그대로 유지할 수 있다.
_CONTENT_DEDUP_FETCH_FACTOR = 4
_CONTENT_DEDUP_FETCH_CAP = 40

MEETING_SOURCE_TYPE = "meeting"
# task/action_item 청크 수가 meeting보다 훨씬 많아 일반 유사도 검색에서 meeting이
# 밀려나는 경우가 잦다. meeting 청크가 하나도 안 뽑혔을 때만 별도로 최소 슬롯을 예약한다.
MEETING_MIN_RESERVED = 2


async def find_task_chunks_by_code(
    pool, project_id: int, code: str, limit: int = 6
) -> list[dict]:
    """업무 코드가 본문에 들어 있는 task 청크를 정확히(단어 경계) 찾는다.

    호출 측에서 code는 [A-Za-z]{2,}-\\d+ 형태로 검증돼 넘어와야 한다(정규식 메타문자 없음).
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(_SEARCH_BY_TASK_CODE_SQL, project_id, code, limit)
    return [dict(row) for row in rows]


def _code_boundary_pattern(code: str) -> str:
    """코드를 단어 경계로 감싼 정규식 문자열. SQL과 파이썬이 같은 문자열을 쓴다.

    두 곳에서 따로 만들면 한쪽만 고쳤을 때 SQL이 찾은 행을 파이썬이 어느 코드 것인지
    몰라 배분에서 조용히 빠진다. 경계를 앞뒤 모두 [^0-9A-Za-z]로 잡는 이유는
    _SEARCH_BY_TASK_CODE_SQL 위 주석에 있다(WF-195가 WF-195A에 오매칭되는 문제).
    """
    return f"(^|[^0-9A-Za-z]){code}([^0-9A-Za-z]|$)"


def _allocate_evenly(rows: list[dict], codes: list[str], limit: int) -> list[dict]:
    """코드마다 한 건씩 돌아가며 limit 까지 채운다.

    유사도 순으로 앞에서 limit 만큼 자르면 한 코드가 슬롯을 독점한다. 운영 실측:
    "FS-4 와 WF-174 와 WF-175 비교해줘" -> [FS-4, FS-4, WF-175] 로 WF-174 가 통째로
    누락됐다. 사용자가 코드 셋을 나열했으면 셋 다 근거에 있어야 한다.

    코드 순서는 질문에 나온 순서다. 슬롯이 모자라면 뒤에 말한 코드부터 밀린다 -
    임의로 고르는 것보다 예측 가능하다.
    """
    matchers = {code: re.compile(_code_boundary_pattern(code), re.IGNORECASE) for code in codes}
    buckets: dict[str, list[dict]] = {code: [] for code in codes}
    for row in rows:
        for code in codes:
            if matchers[code].search(row["content"]):
                buckets[code].append(row)
                break

    picked: list[dict] = []
    depth = 0
    while len(picked) < limit:
        added = False
        for code in codes:
            if len(picked) >= limit:
                break
            bucket = buckets[code]
            if depth < len(bucket):
                picked.append(bucket[depth])
                added = True
        if not added:
            break
        depth += 1
    return picked


async def find_task_chunks_by_code_scored(
    pool,
    project_id: int,
    codes: list[str],
    query_embedding: list[float],
    limit: int = TASK_CODE_MAX_SLOTS,
) -> list[dict]:
    """업무 코드가 본문에 든 task 청크를 유사도와 함께 찾는다(질문 경로용).

    find_task_chunks_by_code 와 다른 점은 셋이다: similarity 를 포함하고, 코드를 여러 개
    한 번에 받고, limit 이 코드별이 아니라 결과 집합 전체 상한이다.

    codes 는 TASK_CODE_PATTERN 으로 추출돼 넘어와야 한다(정규식 메타문자 없음).

    코드를 여러 개 물으면 코드마다 한 건씩 돌아가며 채운다. 유사도 순으로 limit 만큼
    자르면 한 코드가 슬롯을 독점해 다른 코드가 통째로 빠진다(_allocate_evenly 참고).
    """
    embedding_literal = to_vector_literal(query_embedding)
    patterns = [_code_boundary_pattern(code) for code in codes]
    # 슬롯 수만큼만 받아오면 공정 배분을 할 후보 자체가 없다. 넉넉히 받아 파이썬에서 고른다.
    fetch_limit = min(len(codes) * limit, _TASK_CODE_FETCH_CAP)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _SEARCH_BY_TASK_CODES_SCORED_SQL, embedding_literal, project_id, patterns, fetch_limit
        )
    return _allocate_evenly([dict(row) for row in rows], codes, limit)


def _dedupe_fetch_limit(limit: int) -> int:
    """중복을 걸러내고도 limit 칸을 채울 수 있도록 넉넉히 받을 개수.

    0 이하는 그대로 넘긴다 - 기존 호출 계약을 바꾸지 않기 위해서다.
    """
    if limit <= 0:
        return limit
    return min(limit * _CONTENT_DEDUP_FETCH_FACTOR, _CONTENT_DEDUP_FETCH_CAP)


def _dedupe_by_content(rows: list[dict]) -> list[dict]:
    """내용이 같은 청크를 한 건으로 접는다. 순서는 원래 유사도 순 그대로 둔다.

    source_id 가 아니라 content 로 접는 이유: 중복은 같은 내용이 서로 다른 source_id 로
    들어와 생긴 것이라 (source_type, source_id) 로는 하나도 안 걸린다. 반대로 긴 업무
    설명이 여러 청크로 쪼개진 경우는 content 가 서로 달라 잘못 합쳐지지 않는다.

    남길 대표는 (source_type, source_id) 가 가장 작은 행으로 정한다. 내용이 같으면
    임베딩도 같아 유사도가 완전히 동률이라, 이렇게 정하지 않으면 DB 가 돌려주는 순서에
    따라 매번 다른 행이 남는다 - 답변 캐시와 평가 재현이 흔들린다.
    """
    best: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        content = row["content"]
        current = best.get(content)
        if current is None:
            best[content] = row
            order.append(content)
        elif (row["source_type"], row["source_id"]) < (current["source_type"], current["source_id"]):
            best[content] = row
    return [best[content] for content in order]


async def search_similar_chunks(
    pool, project_id: int, query_embedding: list[float], top_k: int = 5, assignee_id: int | None = None
) -> list[dict]:
    embedding_literal = to_vector_literal(query_embedding)
    fetch_limit = _dedupe_fetch_limit(top_k)

    if assignee_id is not None:
        # 담당 업무가 하나도 없어도 프로젝트 전체 검색으로 대체하지 않는다. 대체하면 다른
        # 사람의 업무가 컨텍스트에 섞여, LLM이 그걸 질문자 본인의 담당 업무처럼 답할 위험이
        # 있다 (개인화 질문에서는 정확한 "없음"이 잘못된 "있음"보다 안전하다).
        async with pool.acquire() as conn:
            assignee_rows = await conn.fetch(
                _SEARCH_BY_ASSIGNEE_SQL, embedding_literal, project_id, assignee_id, fetch_limit
            )
        return _dedupe_by_content([dict(row) for row in assignee_rows])[:top_k]

    async with pool.acquire() as conn:
        rows = await conn.fetch(_SEARCH_SQL, embedding_literal, project_id, fetch_limit)
        general = _dedupe_by_content([dict(row) for row in rows])[:top_k]

        # 회의록 예약 여부는 중복을 걷어낸 뒤에 판단해야 한다. 걷어내기 전에 보면 같은
        # 회의록이 여러 벌 들어와 "회의록은 이미 있다"가 되어 예약이 걸리지 않는다.
        has_meeting = any(row["source_type"] == MEETING_SOURCE_TYPE for row in general)
        if has_meeting or top_k <= 0:
            return general

        reserved = min(MEETING_MIN_RESERVED, top_k)
        meeting_rows = await conn.fetch(
            _SEARCH_BY_TYPE_SQL, embedding_literal, project_id, MEETING_SOURCE_TYPE,
            _dedupe_fetch_limit(reserved),
        )
        meeting = _dedupe_by_content([dict(row) for row in meeting_rows])[:reserved]

    if not meeting:
        return general

    slots_for_meeting = min(len(meeting), top_k)
    combined = general[: top_k - slots_for_meeting] + meeting[:slots_for_meeting]
    combined.sort(key=lambda row: row["similarity"], reverse=True)
    # general 과 meeting 이 같은 내용을 물어올 수 있다(회의록 청크가 양쪽에 다 잡히는 경우).
    return _dedupe_by_content(combined)


def _code_slots_for(codes: list[str], top_k: int) -> int:
    """코드 정확 일치에 내줄 칸 수.

    고정 상한(TASK_CODE_MAX_SLOTS)만 쓰면 사용자가 코드를 4개 이상 말했을 때 뒤에 말한
    코드가 조용히 빠진다. 이건 튜닝이 아니라 정확성 문제다 - 질문에 명시한 업무는 근거에
    있어야 하고, 없으면 모델이 그 업무를 아예 언급하지 못한다.

    규칙: 최소 TASK_CODE_MAX_SLOTS 칸, 코드를 더 말했으면 그만큼, 단 top_k 를 넘지 않는다.

      코드 1개 -> 3칸  (한 업무가 여러 청크로 쪼개진 경우를 담고, 2칸은 임베딩에 남긴다)
      코드 3개 -> 3칸  (코드마다 1칸, 2칸은 임베딩)
      코드 4개 -> 4칸  (코드마다 1칸, 1칸은 임베딩)
      코드 5개 -> 5칸  (임베딩 없음)

    코드를 top_k 개 이상 나열했으면 임베딩 칸을 남기지 않는다. 그 질문은 열거 자체가
    질의이므로, 느슨하게 닮은 청크 한 건보다 명시된 업무를 하나 더 넣는 편이 낫다.

    top_k 를 넘게 나열하면 여전히 잘린다. 다만 뒤에 말한 코드부터 예측 가능하게 밀리고,
    로그의 "코드 N개, 정확 일치 M건" 에서 N > M 이면 잘렸다는 뜻이다.
    """
    return min(max(TASK_CODE_MAX_SLOTS, len(codes)), top_k)


async def search_chunks_for_question(
    pool,
    project_id: int,
    question: str,
    query_embedding: list[float],
    top_k: int = 5,
    assignee_id: int | None = None,
) -> list[dict]:
    """질문에 업무 코드가 있으면 정확 일치를 앞에 놓고, 없으면 유사도 검색 그대로 간다.

    "WF-195" 같은 코드는 확률적 유사도가 아니라 식별자다. 임베딩은 질문의 말투와 닮은
    청크를 높게 주기 때문에("어떻게 돼가" 류) 정작 지목된 업무를 놓친다. 운영 데이터
    30문항 평가에서 코드가 든 질문의 Hit@5 가 0.400 이었다.
    """
    # 반환이 한 곳뿐인 것은 의도적이다. 아래 record_question_query 를 반환 직전에 딱 한 번만
    # 부르기 위해서다. 조기 반환으로 흩어 두면 경로가 늘 때마다 계측이 조용히 빠지고,
    # 그 누락은 "그 조건의 질문이 0건"으로 보여 관측값이 아니라 결론을 틀리게 만든다.
    codes: list[str] = []
    code_rows: list[dict] = []
    code_slots = 0
    code_search_failed = False

    # 개인화 질문에는 라우팅을 걸지 않는다. 코드 정확 검색에는 담당자 필터가 없어 남의
    # 담당 업무가 개인화 답변에 섞일 수 있다 (아래 search_similar_chunks 의 assignee 분기와
    # 같은 이유 - 개인화 질문에서는 정확한 "없음"이 잘못된 "있음"보다 안전하다).
    if assignee_id is not None:
        rows = await search_similar_chunks(pool, project_id, query_embedding, top_k, assignee_id)
    else:
        codes = list(dict.fromkeys(TASK_CODE_PATTERN.findall(question or "")))
        if not codes:
            rows = await search_similar_chunks(pool, project_id, query_embedding, top_k)
        else:
            code_slots = _code_slots_for(codes, top_k)
            try:
                code_rows = await find_task_chunks_by_code_scored(
                    pool, project_id, codes, query_embedding, limit=code_slots
                )
            except Exception:
                # 부가 경로가 본 기능을 죽이면 안 된다. 이때 아래 info 로그는 남기지 않는다 -
                # "정확 일치 0건"이 "코드가 정말 없음"과 "조회 실패" 둘을 뜻하면 관측값이
                # 오염된다. 같은 이유로 통계도 code_search_failed 로 구분해 넘긴다.
                logger.warning("업무 코드 검색 실패, 유사도 검색만으로 진행합니다.", exc_info=True)
                code_search_failed = True
                rows = await search_similar_chunks(pool, project_id, query_embedding, top_k)
            else:
                # 개수만 남긴다. 질문 원문도 코드 값도 로그에 넣지 않는다.
                logger.info("코드 라우팅 발동: 코드 %d개, 정확 일치 %d건", len(codes), len(code_rows))
                rows = await _merge_code_hits_with_similar(
                    pool, project_id, query_embedding, top_k, code_rows
                )

    await record_question_query(
        QuestionQueryStats(
            project_id=project_id,
            top_k=top_k,
            personal=assignee_id is not None,
            source_count=len(rows),
            code_count=len(codes),
            code_hits=len(code_rows),
            code_slots=code_slots,
            code_search_failed=code_search_failed,
        )
    )
    return rows


async def _merge_code_hits_with_similar(
    pool, project_id: int, query_embedding: list[float], top_k: int, code_rows: list[dict]
) -> list[dict]:
    """코드 정확 일치를 앞에 놓고 남은 칸을 유사도 검색으로 채운다."""
    # 임베딩은 잔여 칸 수가 아니라 항상 top_k 전체로 요청한다. 줄여서 부르면 회의록 예약이
    # 남은 칸을 통째로 먹는다: top_k=2 면 reserved=min(2,2)=2 라 general[:0] 이 되어
    # 의미 검색 결과가 하나도 안 남는다.
    similar = await search_similar_chunks(pool, project_id, query_embedding, top_k)

    # 코드 히트는 유사도로 재정렬하지 않는다. 정확 일치 청크의 유사도가 임베딩 1등보다
    # 낮은 것이 정상이고(질문 어휘와 겹치는 게 코드뿐이라), 섞어서 줄 세우면 뒤로 밀려
    # 잘려나간다. 그러면 라우팅한 의미가 없다.
    # 코드 히트끼리도 같은 내용이 있을 수 있다(같은 업무가 여러 벌 색인된 경우).
    merged = _dedupe_by_content(list(code_rows))
    seen = {row["content"] for row in merged}
    for row in similar:
        if len(merged) >= top_k:
            break
        # .get() 을 쓰지 않는 것은 의도적이다. 키가 빠지면 모든 행이 None 으로 같아져
        # 조용히 전부 중복 처리되고 근거가 소리 없이 사라진다. 그럴 바에는 터지는 편이 낫다.
        content = row["content"]
        if content in seen:
            continue
        seen.add(content)
        merged.append(row)
    return merged[:top_k]
