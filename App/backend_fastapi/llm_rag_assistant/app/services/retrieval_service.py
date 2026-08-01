from __future__ import annotations

import logging
import re

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

# 질문 하나에서 코드 정확 일치에 내줄 최대 슬롯 수. 운영 실측상 코드 101종 중 100종이
# 청크 1건에만 매칭되므로, 이 값은 "한 코드가 몇 청크로 쪼개지나"가 아니라 "코드를 여러 개
# 물었을 때 몇 개까지 받아주나"를 정한다. 나머지 칸은 임베딩에 남겨 주변 맥락을 잃지 않는다.
TASK_CODE_MAX_SLOTS = 3

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
    """
    # 경계 조건은 _SEARCH_BY_TASK_CODE_SQL 과 글자 그대로 같아야 한다. 뒤 경계가 [^0-9]로
    # 느슨해지면 WF-195 가 WF-195A 에 오매칭된다.
    patterns = [f"(^|[^0-9A-Za-z]){code}([^0-9A-Za-z]|$)" for code in codes]
    embedding_literal = to_vector_literal(query_embedding)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _SEARCH_BY_TASK_CODES_SCORED_SQL, embedding_literal, project_id, patterns, limit
        )
    return [dict(row) for row in rows]


async def search_similar_chunks(
    pool, project_id: int, query_embedding: list[float], top_k: int = 5, assignee_id: int | None = None
) -> list[dict]:
    embedding_literal = to_vector_literal(query_embedding)

    if assignee_id is not None:
        # 담당 업무가 하나도 없어도 프로젝트 전체 검색으로 대체하지 않는다. 대체하면 다른
        # 사람의 업무가 컨텍스트에 섞여, LLM이 그걸 질문자 본인의 담당 업무처럼 답할 위험이
        # 있다 (개인화 질문에서는 정확한 "없음"이 잘못된 "있음"보다 안전하다).
        async with pool.acquire() as conn:
            assignee_rows = await conn.fetch(_SEARCH_BY_ASSIGNEE_SQL, embedding_literal, project_id, assignee_id, top_k)
        return [dict(row) for row in assignee_rows]

    async with pool.acquire() as conn:
        rows = await conn.fetch(_SEARCH_SQL, embedding_literal, project_id, top_k)
        general = [dict(row) for row in rows]

        has_meeting = any(row["source_type"] == MEETING_SOURCE_TYPE for row in general)
        if has_meeting or top_k <= 0:
            return general

        reserved = min(MEETING_MIN_RESERVED, top_k)
        meeting_rows = await conn.fetch(
            _SEARCH_BY_TYPE_SQL, embedding_literal, project_id, MEETING_SOURCE_TYPE, reserved
        )
        meeting = [dict(row) for row in meeting_rows]

    if not meeting:
        return general

    slots_for_meeting = min(len(meeting), top_k)
    combined = general[: top_k - slots_for_meeting] + meeting[:slots_for_meeting]
    combined.sort(key=lambda row: row["similarity"], reverse=True)
    return combined


def _chunk_key(row: dict) -> tuple:
    """완전히 같은 청크만 중복으로 보기 위한 키.

    (source_type, source_id) 만 쓰면 긴 업무 설명이 여러 청크로 쪼개진 경우까지 한 건으로
    합쳐져 근거가 줄어든다. content 까지 봐야 진짜 같은 청크만 사라진다.

    .get() 을 쓰지 않는 것은 의도적이다. 키가 빠지면 모든 행이 (None, None, None) 으로 같아져
    조용히 전부 중복 처리되고 근거가 소리 없이 사라진다. 그럴 바에는 터지는 편이 낫다.
    """
    return (row["source_type"], row["source_id"], row["content"])


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
    # 개인화 질문에는 라우팅을 걸지 않는다. 코드 정확 검색에는 담당자 필터가 없어 남의
    # 담당 업무가 개인화 답변에 섞일 수 있다 (아래 search_similar_chunks 의 assignee 분기와
    # 같은 이유 - 개인화 질문에서는 정확한 "없음"이 잘못된 "있음"보다 안전하다).
    if assignee_id is not None:
        return await search_similar_chunks(pool, project_id, query_embedding, top_k, assignee_id)

    codes = list(dict.fromkeys(TASK_CODE_PATTERN.findall(question or "")))
    if not codes:
        return await search_similar_chunks(pool, project_id, query_embedding, top_k)

    try:
        code_rows = await find_task_chunks_by_code_scored(
            pool, project_id, codes, query_embedding, limit=min(TASK_CODE_MAX_SLOTS, top_k)
        )
    except Exception:
        # 부가 경로가 본 기능을 죽이면 안 된다. 이때 아래 info 로그는 남기지 않는다 -
        # "정확 일치 0건"이 "코드가 정말 없음"과 "조회 실패" 둘을 뜻하면 관측값이 오염된다.
        logger.warning("업무 코드 검색 실패, 유사도 검색만으로 진행합니다.", exc_info=True)
        return await search_similar_chunks(pool, project_id, query_embedding, top_k)

    # 개수만 남긴다. 질문 원문도 코드 값도 로그에 넣지 않는다.
    logger.info("코드 라우팅 발동: 코드 %d개, 정확 일치 %d건", len(codes), len(code_rows))

    # 임베딩은 잔여 칸 수가 아니라 항상 top_k 전체로 요청한다. 줄여서 부르면 회의록 예약이
    # 남은 칸을 통째로 먹는다: top_k=2 면 reserved=min(2,2)=2 라 general[:0] 이 되어
    # 의미 검색 결과가 하나도 안 남는다.
    similar = await search_similar_chunks(pool, project_id, query_embedding, top_k)

    # 코드 히트는 유사도로 재정렬하지 않는다. 정확 일치 청크의 유사도가 임베딩 1등보다
    # 낮은 것이 정상이고(질문 어휘와 겹치는 게 코드뿐이라), 섞어서 줄 세우면 뒤로 밀려
    # 잘려나간다. 그러면 라우팅한 의미가 없다.
    merged = list(code_rows)
    seen = {_chunk_key(row) for row in merged}
    for row in similar:
        if len(merged) >= top_k:
            break
        key = _chunk_key(row)
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)
    return merged[:top_k]
