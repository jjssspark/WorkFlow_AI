from __future__ import annotations

import hashlib
import json
import logging
import re

from core.cache import get_async_redis_client
from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse, RagSource
from llm_rag_assistant.app.services.embedding_service import embed_text
from llm_rag_assistant.app.services.generation_service import (
    generate_answer,
    resolve_generation_provider,
)
from llm_rag_assistant.app.services.project_stats_service import fetch_project_stats
from llm_rag_assistant.app.services.query_rewrite_service import rewrite_question
from llm_rag_assistant.app.services.retrieval_service import search_chunks_for_question
from llm_rag_assistant.app.services.task_facts_service import enrich_with_facts

logger = logging.getLogger(__name__)

_SNIPPET_MAX_LEN = 200
# 캐시 키 해시에 들어가므로, 올리면 프로젝트 데이터 변경 없이도 기존 답변 캐시가 전부
# 무효화된다. 응답 스키마뿐 아니라 프롬프트 구성이 바뀔 때도 올려야 한다. 그러지 않으면
# 배포 뒤에도 이전 프롬프트로 만든 답변이 TTL(30분) 동안 계속 반환된다.
# v2: 개인화 질문 컨텍스트에 담당자 필터 안내문 추가 (generation_service._PERSONAL_CONTEXT_NOTICE)
# v3: 출처 줄에 마감일·상태·우선순위 추가 (task_facts_service.enrich_with_facts)
# v4: 개인화 안내문 강화 + 생성 temperature 고정 (generation_service)
# v5: 프로젝트 전수 집계 블록을 컨텍스트에 주입 (project_stats_service / generation_service)
# v6: 개인화 질문에 질문자 본인 전수 집계("내 업무") 블록 추가
# v7: 마감 임박 업무 확정 목록 + 지난 마감 건수 추가 (project_stats_service)
# v8: 블로커 업무 확정 목록(사유·마감·우선순위) 추가 (project_stats_service)
# v9: 블로커 줄의 사용자 입력을 한 줄로 접고 길이 제한 (generation_service._one_line)
# v10: 캐시 키에 생성 프로바이더 포함 - 프로바이더 전환 시 이전 백엔드 답변 혼입 방지
# v11: 생성 체인에 Gemini API 폴백 단계 추가 (HF -> Gemini -> Ollama). RAG_PROVIDER 미지정
# 시 resolve_generation_provider()가 개별 프로바이더 이름 대신 "auto"를 반환하도록 바뀌어,
# 이 값이 들어가는 캐시 키도 이전 버전과 달라진다.
# v12: 답변을 마크다운 없이 평문으로 생성하도록 지시 + 출력에서 마크다운 기호 제거
# (generation_service._strip_markdown). 올리지 않으면 마크다운이 섞인 옛 답변이 계속 나간다.
# v13: 나열 항목 앞에 '- '를 붙이도록 프롬프트에 출력 예시 추가(기호 없이 줄바꿈만 하던 문제) +
# 목록 다음 문단 앞 빈 줄 보정 (generation_service._space_out_list_blocks)
# v14: 업무 코드가 든 질문을 코드 정확 일치로 먼저 검색(질의 라우팅). 검색 결과가 달라지므로
# 올리지 않으면 30분 TTL 동안 옛 검색으로 만든 답변이 계속 나가 배포 효과가 안 보인다.
# v15: 검색 결과 구성이 두 가지 바뀌었다(둘 다 v14 배포 전이라 한 버전으로 묶는다).
#   - 내용이 같은 청크를 한 건으로 접고 남는 칸을 다른 근거로 채운다.
#   - 코드를 4개 이상 말하면 말한 만큼 칸을 준다(전에는 3개에서 잘렸다).
# 같은 질문에 돌아가는 출처 목록이 달라지므로 v14 캐시를 그대로 쓰면 옛 구성이 계속 나간다.
_ANSWER_CACHE_SCHEMA_VERSION = "v15"
_ANSWER_CACHE_TTL_SECONDS = 1800

# "내 할 일 알려줘" 류 개인화 질문 판별용. 순수 벡터 유사도만으로는 "내"가 누구인지 구분할
# 수 없어 (일반 문구라 특정 담당자 청크와 유사도가 두드러지지 않음) 키워드로 의도를 감지해
# assignee_id 필터 검색으로 전환한다.
# 부분 문자열로 비교하면 "문제 ", "과제 ", "안내 " 같은 무관한 단어에 "제 "가 포함돼 오탐한다
# (예: "이 문제 알려줘"가 개인화 질문으로 잘못 분류됨) - 공백으로 나눈 토큰 단위로 정확히
# 일치할 때만 개인화 의도로 판단한다. 토큰 양끝에 붙는 문장부호/괄호/따옴표는 비교 전에 제거한다
# (그렇지 않으면 "내가?", "(제가", "제가:"처럼 조사 뒤에 부호가 붙은 흔한 표현을 놓친다).
_PERSONAL_INTENT_TOKENS = {"내가", "제가", "나는", "저는", "나의", "저의", "나한테", "저한테", "내", "제"}
_LEADING_PUNCTUATION_PATTERN = re.compile(r"^[\"'“‘\(\[{]+")
_TRAILING_PUNCTUATION_PATTERN = re.compile(r"[,.?!~:;…\"'”’\)\]}]+$")

# "내업무", "제할일"처럼 조사/공백 없이 붙여 쓴 압축형은 위 토큰 정확 일치로 못 잡는다.
# "내"/"제"를 그냥 접두사로 허용하면 "내용", "내년", "제안", "제출" 같은 무관 단어까지 오탐하므로,
# 담당 업무를 가리키는 명사가 바로 뒤에 붙을 때만(=단어 시작 위치) 개인화 의도로 인정한다.
# "내가할일줘"처럼 명사 앞에 조사(가/는|이)가 공백 없이 붙는 경우도 있어, "내"/"제" 뒤에
# 단일 조사 한 글자를 선택적으로 허용한다.
_COMPACT_PERSONAL_TASK_PATTERN = re.compile(
    r"(?:^|[\s\"'“‘\(\[{])(?:내|제)(?:가|는|이)?"
    r"(?=업무|담당|맡|할\s?일|일감|태스크|건|리스트|목록|todo|task|꺼|것)"
)


def _normalize_token(token: str) -> str:
    token = _LEADING_PUNCTUATION_PATTERN.sub("", token)
    return _TRAILING_PUNCTUATION_PATTERN.sub("", token)


def _is_personal_intent(question: str) -> bool:
    tokens = {_normalize_token(token) for token in question.split()}
    if _PERSONAL_INTENT_TOKENS & tokens:
        return True
    return bool(_COMPACT_PERSONAL_TASK_PATTERN.search(question))


def _answer_cache_key(
    project_id: int,
    assignee_id: int | None,
    question: str,
    cache_epoch: str = "0",
) -> str:
    canonical_basis = json.dumps(
        {
            "schema_version": _ANSWER_CACHE_SCHEMA_VERSION,
            "project_id": project_id,
            "assignee_id": assignee_id,
            "question": question,
            "cache_epoch": cache_epoch,
            # 모델이 다르면 같은 질문에도 답이 다르다. 이게 없으면 프로바이더를 되돌린 뒤에도
            # 이전 백엔드가 만든 답변이 TTL(30분) 동안 계속 나간다.
            "provider": resolve_generation_provider(),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical_basis.encode("utf-8")).hexdigest()
    assignee_scope = str(assignee_id) if assignee_id is not None else "none"
    return f"rag_answer:{project_id}:{assignee_scope}:{digest}"


async def _read_project_cache_epoch(redis_client, project_id: int) -> str | None:
    try:
        epoch = await redis_client.get(f"rag_epoch:{project_id}")
    except Exception:
        logger.warning("RAG 답변 캐시 버전 조회 실패, 캐시 없이 진행합니다.")
        return None
    return epoch if epoch is not None else "0"


async def _read_cached_response(redis_client, cache_key: str) -> RagQueryResponse | None:
    try:
        cached = await redis_client.get(cache_key)
    except Exception:
        logger.warning("RAG 답변 캐시 조회 실패, 캐시 없이 진행합니다.")
        return None
    if cached is None:
        return None

    try:
        return RagQueryResponse.model_validate_json(cached)
    except Exception:
        logger.warning("RAG 답변 캐시 역직렬화 실패, 손상 값을 삭제합니다.")

    try:
        await redis_client.delete(cache_key)
    except Exception:
        logger.warning("RAG 답변 손상 캐시 삭제 실패, 캐시 없이 진행합니다.")
    return None


async def _write_cached_response(redis_client, cache_key: str, response: RagQueryResponse) -> None:
    try:
        await redis_client.set(
            cache_key,
            response.model_dump_json(),
            ex=_ANSWER_CACHE_TTL_SECONDS,
        )
    except Exception:
        logger.warning("RAG 답변 캐시 저장 실패, 결과는 정상 반환합니다.")


async def answer_question(
    pool,
    project_id: int,
    question: str,
    user_id: int | None = None,
    history: list[dict] | None = None,
) -> RagQueryResponse:
    # 빈/공백 질문은 Spring이 보통 400으로 막지만, 내부 호출 경로가 넘겨도 임베딩·검색·생성
    # LLM을 태우지 않도록 여기서 즉시 끊는다(모든 호출 경로가 지나는 단일 초크포인트).
    if question is None or not question.strip():
        return RagQueryResponse(answer="질문을 입력해주세요.", sources=[])

    # 후속 질문("그 업무는 언제까지야?")은 재작성으로 독립 질문화한다. 이후 임베딩·개인화 판정·
    # 캐시 키·생성은 전부 재작성된 질문(effective_question)을 기준으로 한다. 히스토리가 없으면
    # 재작성 LLM을 호출하지 않아 첫 질문이 느려지지 않는다.
    effective_question = question
    if history:
        effective_question = await rewrite_question(history, question)

    assignee_id = user_id if user_id is not None and _is_personal_intent(effective_question) else None
    cache_key = None
    cache_epoch = None

    try:
        redis_client = get_async_redis_client()
    except Exception:
        logger.warning("RAG 답변 캐시 클라이언트 생성 실패, 캐시 없이 진행합니다.")
        redis_client = None

    if redis_client is not None:
        cache_epoch = await _read_project_cache_epoch(redis_client, project_id)
        if cache_epoch is not None:
            cache_key = _answer_cache_key(project_id, assignee_id, effective_question, cache_epoch)
            cached_response = await _read_cached_response(redis_client, cache_key)
            if cached_response is not None:
                latest_epoch = await _read_project_cache_epoch(redis_client, project_id)
                if latest_epoch == cache_epoch:
                    return cached_response
                cache_epoch = latest_epoch
                cache_key = (
                    _answer_cache_key(project_id, assignee_id, effective_question, cache_epoch)
                    if cache_epoch is not None
                    else None
                )

    query_embedding = await embed_text(effective_question)
    # effective_question(재작성본)을 넘긴다. 후속 질문("그거 언제까지야?")은 재작성을 거쳐야
    # 업무 코드가 문장에 드러나므로 원문을 넘기면 라우팅이 발동하지 않는다.
    rows = await search_chunks_for_question(
        pool, project_id, effective_question, query_embedding, top_k=5, assignee_id=assignee_id
    )
    # 청크 본문에 없는 마감일·상태·우선순위를 붙인다. 실패해도 facts만 비고 답변은 정상 진행된다.
    enriched_rows = await enrich_with_facts(pool, project_id, rows)
    # 검색은 상위 k개(표본)만 본다. "블로커 몇 건이야" 같은 전수 집계 질문은 이 경로로 답할 수
    # 없어 프로젝트 전체 집계를 따로 붙인다. 캐시 히트 시에는 위에서 이미 반환되므로 실행되지
    # 않는다 - 늘어나는 왕복은 캐시 미스 1회뿐이다.
    stats = await fetch_project_stats(pool, project_id, assignee_id=assignee_id)
    answer = await generate_answer(
        effective_question, enriched_rows, is_personal=assignee_id is not None, stats=stats
    )

    sources = _dedupe_sources(
        RagSource(
            source_type=row["source_type"],
            source_id=row["source_id"],
            content_snippet=_shorten(row["content"], _SNIPPET_MAX_LEN),
            similarity=row["similarity"],
        )
        for row in rows
    )
    response = RagQueryResponse(answer=answer, sources=sources)
    if redis_client is not None and cache_key is not None and cache_epoch is not None:
        latest_epoch = await _read_project_cache_epoch(redis_client, project_id)
        if latest_epoch == cache_epoch:
            await _write_cached_response(redis_client, cache_key, response)
    return response


def _dedupe_sources(sources) -> list[RagSource]:
    """같은 원본에서 나온 청크가 여러 개 검색되면 출처 목록에는 1건만 남긴다.

    긴 회의록은 여러 청크로 쪼개져 있어 상위 5개가 전부 같은 회의록인 경우가 흔하다.
    그대로 내보내면 사용자에게 같은 문서 링크가 5줄 반복돼 근거의 폭이 넓어 보이지 않는다.

    검색 결과는 유사도 내림차순이므로 첫 등장이 곧 그 원본의 최고 유사도다.
    LLM 컨텍스트(enriched_rows)는 줄이지 않는다 - 같은 문서라도 청크마다 내용이 달라
    합치면 답변 근거 자체가 줄어든다. 여기서 줄이는 건 표시용 목록뿐이다.
    """
    seen: set[tuple[str, int]] = set()
    unique: list[RagSource] = []
    for source in sources:
        key = (source.source_type, source.source_id)
        if key in seen:
            continue
        seen.add(key)
        unique.append(source)
    return unique


def _shorten(value: str, max_len: int) -> str:
    return value if len(value) <= max_len else value[: max_len - 1] + "…"
