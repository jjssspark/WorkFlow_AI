from __future__ import annotations

import logging
from unittest.mock import AsyncMock, Mock, patch

import pytest

from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse, RagSource
from llm_rag_assistant.app.services.chat_service import (
    _ANSWER_CACHE_SCHEMA_VERSION,
    _answer_cache_key,
    _is_personal_intent,
    answer_question,
)


class _FakeAsyncRedis:
    def __init__(self, initial: dict[str, str] | None = None) -> None:
        self.store = dict(initial or {})
        self.set_calls: list[tuple[str, str, int | None]] = []
        self.deleted_keys: list[str] = []

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value
        self.set_calls.append((key, value, ex))

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)
        self.deleted_keys.append(key)


@pytest.fixture(autouse=True)
def default_cache_miss() -> object:
    with patch(
        "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
        return_value=_FakeAsyncRedis(),
    ):
        yield


@pytest.mark.asyncio
async def test_answer_question_returns_answer_with_sources() -> None:
    pool = object()
    rows = [
        {"source_type": "meeting", "source_id": 1, "content": "회의록 상세 내용" * 30, "similarity": 0.87},
    ]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1, 0.2]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ) as mock_search,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="이것이 답변입니다"),
        ),
    ):
        result = await answer_question(pool, project_id=5, question="질문")

    mock_search.assert_awaited_once_with(pool, 5, "질문", [0.1, 0.2], top_k=5, assignee_id=None)
    assert result.answer == "이것이 답변입니다"
    assert len(result.sources) == 1
    assert result.sources[0].source_type == "meeting"
    assert result.sources[0].source_id == 1
    assert len(result.sources[0].content_snippet) <= 200
    assert result.sources[0].similarity == 0.87


@pytest.mark.asyncio
async def test_answer_question_handles_no_matching_chunks() -> None:
    pool = object()

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="근거 없음: 관련 자료를 찾지 못했습니다"),
        ),
    ):
        result = await answer_question(pool, project_id=5, question="관련 없는 질문")

    assert result.sources == []
    assert "근거 없음" in result.answer


@pytest.mark.asyncio
@pytest.mark.parametrize("blank", ["", "   ", "\n\t"])
async def test_answer_question_short_circuits_blank_question_without_llm(blank: str) -> None:
    # Spring이 보통 400으로 막지만, 내부 호출 경로(그래프 등)가 빈 질문을 넘겨도
    # 임베딩·검색·생성 LLM을 태우지 않고 즉시 빈 응답으로 끊는다.
    embed = AsyncMock(return_value=[0.1])
    gen = AsyncMock(return_value="답변")
    with (
        patch("llm_rag_assistant.app.services.chat_service.embed_text", new=embed),
        patch("llm_rag_assistant.app.services.chat_service.generate_answer", new=gen),
    ):
        result = await answer_question(object(), project_id=5, question=blank)

    assert result.sources == []
    embed.assert_not_awaited()
    gen.assert_not_awaited()


@pytest.mark.asyncio
async def test_answer_question_filters_by_assignee_when_personal_intent_and_user_id_given() -> None:
    pool = object()
    rows = [{"source_type": "task", "source_id": 3, "content": "내 업무", "similarity": 0.9}]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ) as mock_search,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ) as mock_generate,
    ):
        await answer_question(pool, project_id=5, question="내가 담당한 업무 알려줘", user_id=42)

    mock_search.assert_awaited_once_with(
        pool, 5, "내가 담당한 업무 알려줘", [0.1], top_k=5, assignee_id=42
    )
    # 담당자 필터를 걸었다는 사실이 생성 단계까지 전달돼야 한다. 전달하지 않으면 모델이
    # 청크가 질문자 것인지 알 수 없어 담당 업무가 있어도 '근거 없음'으로 답한다.
    assert mock_generate.await_args.kwargs["is_personal"] is True


@pytest.mark.asyncio
async def test_answer_question_does_not_filter_by_assignee_for_non_personal_question() -> None:
    pool = object()

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ) as mock_search,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ) as mock_generate,
    ):
        await answer_question(pool, project_id=5, question="프로젝트 전체 업무 현황 알려줘", user_id=42)

    mock_search.assert_awaited_once_with(
        pool, 5, "프로젝트 전체 업무 현황 알려줘", [0.1], top_k=5, assignee_id=None
    )
    assert mock_generate.await_args.kwargs["is_personal"] is False


@pytest.mark.parametrize(
    "question",
    [
        "이 문제 알려줘",
        "이번 과제 진행 상황이 어때?",
        "안내 사항 정리해줘",
        "제안서 초안 만들어줘",
    ],
)
def test_is_personal_intent_does_not_false_positive_on_substring_matches(question: str) -> None:
    """'제 '가 '문제 '/'과제 '/'안내 '/'제안' 같은 무관한 단어의 부분 문자열로 들어있다고
    개인화 질문으로 오인하면 안 된다 (토큰 단위 정확 일치여야 함)."""
    assert _is_personal_intent(question) is False


@pytest.mark.parametrize(
    "question",
    ["내가 담당한 업무 알려줘", "제가 맡은 태스크 뭐야", "나의 할 일 정리해줘", "내 업무 목록 보여줘"],
)
def test_is_personal_intent_detects_standalone_personal_pronoun_tokens(question: str) -> None:
    assert _is_personal_intent(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "내가? 무슨 업무 맡았지",
        "제가, 담당한 업무가 뭐예요",
        "나는 할 일이 뭐야?",
        "저는 뭘 해야 하나요~",
    ],
)
def test_is_personal_intent_handles_trailing_punctuation_and_topic_particle_forms(question: str) -> None:
    """'내가?'처럼 조사 뒤에 문장부호가 붙거나, '나는/저는'처럼 목록에 없던 흔한 표현도
    개인화 질문으로 인식해야 한다."""
    assert _is_personal_intent(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "(내가 담당한 업무 뭐야",
        "제가: 뭐 해야 하죠",
        "저한테) 할당된 태스크 알려줘",
        '"내가" 맡은 업무가 뭔데',
    ],
)
def test_is_personal_intent_strips_wrapping_brackets_and_colons(question: str) -> None:
    """괄호로 둘러싸이거나 콜론이 붙은 조사 표현도 (기존엔 문장부호 스트립 대상이 아니었음)
    개인화 질문으로 인식해야 한다."""
    assert _is_personal_intent(question) is True


@pytest.mark.parametrize(
    "question",
    ["내업무 알려줘", "제업무 뭐야", "제담당 태스크 뭐지", "내할일 정리해줘", "내꺼 뭐 있어"],
)
def test_is_personal_intent_detects_compact_pronoun_task_compounds(question: str) -> None:
    """'내 업무'를 공백 없이 붙여 쓴 '내업무' 같은 압축형도 놓치지 않아야 한다."""
    assert _is_personal_intent(question) is True


@pytest.mark.parametrize(
    "question",
    ["내년 계획 알려줘", "내용 정리해줘", "제안서 검토해줘", "제출 기한이 언제야", "제목 정해줘"],
)
def test_is_personal_intent_compact_pattern_does_not_false_positive(question: str) -> None:
    """압축형 탐지가 '내년'/'내용'/'제안'/'제출'/'제목' 같은 무관한 단어까지 오탐하면 안 된다."""
    assert _is_personal_intent(question) is False


@pytest.mark.parametrize(
    "question",
    [
        "내가할일줘",
        "제가맡은거 뭐야",
        "내 todo 알려줘",
        "제 task 목록 보여줘",
    ],
)
def test_is_personal_intent_detects_particle_attached_compact_forms(question: str) -> None:
    assert _is_personal_intent(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "todo 알려줘",
        "task 목록 보여줘",
        "이 프로젝트에 task가 몇 개야?",
        "todo 앱 추천해줘",
    ],
)
def test_is_personal_intent_bare_todo_task_without_pronoun_does_not_false_positive(question: str) -> None:
    """'todo'/'task'가 '내'/'제' 없이 단독으로 쓰이면 개인화 의도가 아니다 — 일반 질문까지
    개인화로 오분류하지 않도록 항상 인칭대명사 문맥을 요구한다."""
    assert _is_personal_intent(question) is False


@pytest.mark.parametrize(
    "question",
    [
        "내년 계획 알려줘",
        "내용 요약해줘",
        "제안서 검토해줘",
        "제출 기한이 언제야",
    ],
)
def test_is_personal_intent_particle_pattern_does_not_false_positive(question: str) -> None:
    assert _is_personal_intent(question) is False


@pytest.mark.parametrize(
    "question",
    [
        "일요일에 회의 있어?",
        "일단 확인해볼게",
        "제일 중요한 건 뭐야",
    ],
)
def test_is_personal_intent_il_suffix_does_not_false_positive(question: str) -> None:
    assert _is_personal_intent(question) is False


@pytest.mark.parametrize(
    "question",
    [
        "“내업무 확인해줘”",
        "“제할일 뭐야”",
        "“내담당 태스크 보여줄래”",
    ],
)
def test_is_personal_intent_detects_curly_quoted_compact_forms(question: str) -> None:
    """Korean-style curly double quotes (U+201C/U+201D) wrapping compact personal-intent
    forms should still be recognized as personal intent. Regression test for missing
    curly quote support in _COMPACT_PERSONAL_TASK_PATTERN leading boundary."""
    assert _is_personal_intent(question) is True


def test_answer_cache_key_scopes_schema_project_assignee_and_exact_question() -> None:
    baseline = _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문")

    assert baseline == _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문")
    assert baseline != _answer_cache_key(project_id=6, assignee_id=None, question="동일 질문")
    assert baseline != _answer_cache_key(project_id=5, assignee_id=42, question="동일 질문")
    assert baseline != _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문 ")

    # 현재 값과 반드시 다른 값이어야 한다. 실제 버전을 그대로 쓰면 패치가 무의미해져
    # 이 검증이 조용히 통과만 한다.
    with patch("llm_rag_assistant.app.services.chat_service._ANSWER_CACHE_SCHEMA_VERSION", "other-version"):
        assert baseline != _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문")

    assert baseline != _answer_cache_key(
        project_id=5,
        assignee_id=None,
        question="동일 질문",
        cache_epoch="1",
    )


@pytest.mark.asyncio
async def test_answer_question_cache_hit_skips_embedding_search_and_generation() -> None:
    cached = RagQueryResponse(
        answer="캐시 답변",
        sources=[RagSource(source_type="task", source_id=3, content_snippet="근거", similarity=0.9)],
    )
    cache = _FakeAsyncRedis({_answer_cache_key(5, None, "질문"): cached.model_dump_json()})

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch("llm_rag_assistant.app.services.chat_service.embed_text", new=AsyncMock()) as embed,
        patch("llm_rag_assistant.app.services.chat_service.search_chunks_for_question", new=AsyncMock()) as search,
        patch("llm_rag_assistant.app.services.chat_service.generate_answer", new=AsyncMock()) as generate,
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result == cached
    embed.assert_not_awaited()
    search.assert_not_awaited()
    generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_answer_question_project_epoch_change_bypasses_stale_cached_answer() -> None:
    stale = RagQueryResponse(answer="삭제 전 답변", sources=[])
    cache = _FakeAsyncRedis(
        {
            "rag_epoch:5": "2",
            _answer_cache_key(5, None, "질문", cache_epoch="1"): stale.model_dump_json(),
        }
    )

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="삭제 후 답변"),
        ),
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result.answer == "삭제 후 답변"
    assert cache.set_calls[0][0] == _answer_cache_key(5, None, "질문", cache_epoch="2")


@pytest.mark.asyncio
async def test_answer_question_rechecks_epoch_before_returning_cache_hit() -> None:
    stale = RagQueryResponse(answer="권한 변경 전 답변", sources=[])
    cache = _FakeAsyncRedis(
        {_answer_cache_key(5, None, "질문", cache_epoch="1"): stale.model_dump_json()}
    )
    epoch_reads = iter(("1", "2", "2"))
    original_get = cache.get

    async def get_with_epoch_change(key: str) -> str | None:
        if key == "rag_epoch:5":
            return next(epoch_reads)
        return await original_get(key)

    cache.get = get_with_epoch_change
    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="권한 변경 후 답변"),
        ),
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result.answer == "권한 변경 후 답변"


@pytest.mark.asyncio
async def test_answer_question_cache_miss_is_stored_for_1800_seconds_and_reused() -> None:
    cache = _FakeAsyncRedis()

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ) as embed,
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ) as search,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="새 답변"),
        ) as generate,
    ):
        first = await answer_question(object(), project_id=5, question="질문")
        second = await answer_question(object(), project_id=5, question="질문")

    assert first == second
    assert cache.set_calls[0][2] == 1800
    embed.assert_awaited_once()
    search.assert_awaited_once()
    generate.assert_awaited_once()


@pytest.mark.asyncio
async def test_answer_question_uses_effective_personal_assignee_in_cache_scope() -> None:
    cache = _FakeAsyncRedis()

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ) as search,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        await answer_question(object(), 5, "내가 담당한 업무 알려줘", user_id=42)
        await answer_question(object(), 5, "프로젝트 전체 업무 현황 알려줘", user_id=42)

    assert {call[0] for call in cache.set_calls} == {
        _answer_cache_key(5, 42, "내가 담당한 업무 알려줘"),
        _answer_cache_key(5, None, "프로젝트 전체 업무 현황 알려줘"),
    }
    assert search.await_args_list[0].kwargs["assignee_id"] == 42
    assert search.await_args_list[1].kwargs["assignee_id"] is None


@pytest.mark.asyncio
async def test_answer_question_deletes_corrupt_cache_and_recomputes(caplog: pytest.LogCaptureFixture) -> None:
    key = _answer_cache_key(5, None, "민감한 질문 원문")
    cache = _FakeAsyncRedis({key: '{"answer": "민감한 캐시 값"}'})

    with (
        caplog.at_level(logging.WARNING),
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="복구 답변"),
        ),
    ):
        result = await answer_question(object(), 5, "민감한 질문 원문")

    assert result.answer == "복구 답변"
    assert cache.deleted_keys == [key]
    assert "RAG 답변 캐시 역직렬화 실패" in caplog.text
    assert "민감한 질문 원문" not in caplog.text
    assert "민감한 캐시 값" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_point", ["client", "get", "set", "delete"])
async def test_answer_question_cache_failures_warn_and_fail_open(
    failure_point: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    connection_detail_sentinel = "redis://fastapi:secret-password@private-redis:6379/0"
    cache = _FakeAsyncRedis()
    key = _answer_cache_key(5, None, "로그 금지 질문")
    if failure_point == "delete":
        cache.store[key] = "invalid-json"

    if failure_point != "client":
        failing_method = AsyncMock(side_effect=ConnectionError(connection_detail_sentinel))
        setattr(cache, failure_point, failing_method)

    client = (
        Mock(side_effect=ConnectionError(connection_detail_sentinel))
        if failure_point == "client"
        else Mock(return_value=cache)
    )

    with (
        caplog.at_level(logging.WARNING),
        patch("llm_rag_assistant.app.services.chat_service.get_async_redis_client", client),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="정상 답변"),
        ),
    ):
        result = await answer_question(object(), 5, "로그 금지 질문")

    assert result.answer == "정상 답변"
    assert "RAG 답변 캐시" in caplog.text
    assert "로그 금지 질문" not in caplog.text
    assert "정상 답변" not in caplog.text
    assert connection_detail_sentinel not in caplog.text


@pytest.mark.asyncio
async def test_answer_question_enriches_search_results_with_facts() -> None:
    """검색 결과를 사실 조회로 보강한 뒤 생성에 넘겨야 마감일 질문에 답할 수 있다."""
    pool = object()
    rows = [{"source_type": "task", "source_id": 12, "content": "로그인 API 구현", "similarity": 0.9}]
    enriched = [{**rows[0], "facts": {"due_date": "2026-08-01", "status": "진행중", "priority": "high"}}]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.enrich_with_facts",
            new=AsyncMock(return_value=enriched),
        ) as mock_enrich,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="2026-08-01 마감입니다"),
        ) as mock_generate,
    ):
        result = await answer_question(pool, project_id=5, question="로그인 API 마감일은?")

    mock_enrich.assert_awaited_once_with(pool, 5, rows)
    assert mock_generate.await_args.args[1] == enriched
    assert result.answer == "2026-08-01 마감입니다"


@pytest.mark.asyncio
async def test_answer_question_snippet_uses_original_content_not_facts() -> None:
    """출처 스니펫은 청크 원문 기준이어야 한다. 사실 문자열이 섞이면 출처 표시가 오염된다."""
    enriched = [
        {
            "source_type": "task",
            "source_id": 12,
            "content": "로그인 API 구현",
            "similarity": 0.9,
            "facts": {"due_date": "2026-08-01", "status": "진행중", "priority": "high"},
        }
    ]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=enriched),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.enrich_with_facts",
            new=AsyncMock(return_value=enriched),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result.sources[0].content_snippet == "로그인 API 구현"


@pytest.mark.asyncio
async def test_sources_map_one_to_one_to_search_rows_without_cross_wiring() -> None:
    """반환 출처가 검색 행과 순서·개수·필드까지 1:1로 대응해야 한다.

    출처 목록은 사용자가 답변 근거를 직접 열어보는 통로다. ID가 한 칸이라도 엇갈리면
    근거가 아닌 문서를 근거라고 제시하게 된다. tasks와 meeting_action_items는 ID가
    겹칠 수 있으므로 (source_type, source_id) 쌍이 함께 보존되는지까지 확인한다.
    """
    rows = [
        {"source_type": "task", "source_id": 7, "content": "업무 7 본문", "similarity": 0.91},
        {"source_type": "action_item", "source_id": 7, "content": "액션 7 본문", "similarity": 0.88},
        {"source_type": "meeting", "source_id": 3, "content": "회의 3 본문", "similarity": 0.72},
    ]
    enriched = [{**row, "facts": None} for row in rows]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.enrich_with_facts",
            new=AsyncMock(return_value=enriched),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert [
        (source.source_type, source.source_id, source.content_snippet, source.similarity)
        for source in result.sources
    ] == [
        ("task", 7, "업무 7 본문", 0.91),
        ("action_item", 7, "액션 7 본문", 0.88),
        ("meeting", 3, "회의 3 본문", 0.72),
    ]


@pytest.mark.asyncio
async def test_sources_collapse_chunks_from_the_same_origin() -> None:
    """긴 문서는 여러 청크로 쪼개져 상위 K개가 전부 같은 원본인 경우가 흔하다.

    그대로 내보내면 같은 회의록 링크가 5줄 반복돼 근거가 하나뿐이라는 사실이 가려진다.
    유사도 내림차순이므로 각 원본의 첫 등장(=최고 유사도)만 남긴다.
    """
    rows = [
        {"source_type": "meeting", "source_id": 3, "content": "회의 앞부분", "similarity": 0.95},
        {"source_type": "meeting", "source_id": 3, "content": "회의 중간부분", "similarity": 0.90},
        {"source_type": "meeting", "source_id": 3, "content": "회의 뒷부분", "similarity": 0.85},
        {"source_type": "task", "source_id": 7, "content": "업무 7", "similarity": 0.80},
    ]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.enrich_with_facts",
            new=AsyncMock(return_value=[{**row, "facts": None} for row in rows]),
        ) as mock_enrich,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ) as mock_generate,
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert [(source.source_type, source.source_id) for source in result.sources] == [
        ("meeting", 3),
        ("task", 7),
    ]
    # 남는 건 각 원본의 최고 유사도 건이어야 한다.
    assert result.sources[0].similarity == 0.95
    assert result.sources[0].content_snippet == "회의 앞부분"
    # 컨텍스트는 줄이지 않는다. 청크마다 내용이 달라 합치면 답변 근거가 준다.
    assert len(mock_enrich.await_args.args[2]) == 4
    assert len(mock_generate.await_args.args[1]) == 4


@pytest.mark.asyncio
async def test_sources_keep_distinct_origins_that_share_an_id() -> None:
    """source_id 숫자가 같아도 source_type이 다르면 서로 다른 원본이다 - 합치면 안 된다."""
    rows = [
        {"source_type": "task", "source_id": 7, "content": "업무 7", "similarity": 0.9},
        {"source_type": "action_item", "source_id": 7, "content": "액션 7", "similarity": 0.8},
    ]

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=rows),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.enrich_with_facts",
            new=AsyncMock(return_value=[{**row, "facts": None} for row in rows]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert [(source.source_type, source.source_id) for source in result.sources] == [
        ("task", 7),
        ("action_item", 7),
    ]


_MULTITURN_HISTORY = [
    {"role": "user", "content": "내 업무가 뭐야?"},
    {"role": "assistant", "content": "로그인 API 구현 업무가 있습니다"},
]


def _pipeline_patches(rewrite_return: str):
    """멀티턴 파이프라인 테스트 공통 패치. rewrite_question을 고정 반환으로 스텁한다."""
    return (
        patch(
            "llm_rag_assistant.app.services.chat_service.rewrite_question",
            new=AsyncMock(return_value=rewrite_return),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    )


@pytest.mark.asyncio
async def test_rewritten_question_is_used_for_embedding() -> None:
    """후속 질문은 재작성된 독립 질문으로 임베딩해야 엉뚱한 청크가 검색되지 않는다."""
    rewrite, embed_patch, search, generate = _pipeline_patches("로그인 API 구현 업무의 마감일은?")

    with rewrite as mock_rewrite, embed_patch as embed, search, generate:
        embed.return_value = [0.1]
        await answer_question(
            object(), project_id=5, question="그 업무는 언제까지야?", history=_MULTITURN_HISTORY
        )

    mock_rewrite.assert_awaited_once_with(_MULTITURN_HISTORY, "그 업무는 언제까지야?")
    assert embed.await_args.args[0] == "로그인 API 구현 업무의 마감일은?"


@pytest.mark.asyncio
async def test_rewritten_question_is_what_the_code_routing_sees() -> None:
    """원문("그 업무 어때?")에는 업무 코드가 없고 재작성본에만 드러난다. 원문을 넘기면
    코드 라우팅이 발동하지 않아 정확 일치 검색을 통째로 놓친다."""
    rewrite, embed_patch, search_patch, generate = _pipeline_patches("WF-195 업무의 마감일은?")

    with rewrite, embed_patch, search_patch as search, generate:
        await answer_question(
            object(), project_id=5, question="그 업무 어때?", history=_MULTITURN_HISTORY
        )

    assert search.await_args.args[2] == "WF-195 업무의 마감일은?"


@pytest.mark.asyncio
async def test_rewritten_question_drives_personal_intent_detection() -> None:
    """원문은 비개인화("그건")여도 재작성이 개인화 질문이면 assignee 필터가 걸려야 한다."""
    rewrite, embed_patch, search_patch, generate = _pipeline_patches("내 담당 업무의 마감일은?")

    with rewrite, embed_patch, search_patch as search, generate:
        await answer_question(
            object(),
            project_id=5,
            question="그건 언제까지야?",
            user_id=42,
            history=_MULTITURN_HISTORY,
        )

    assert search.await_args.kwargs["assignee_id"] == 42


@pytest.mark.asyncio
async def test_cache_key_is_scoped_by_rewritten_question() -> None:
    """같은 원문이라도 히스토리가 달라 재작성이 달라지면 캐시 키도 달라야 한다."""
    cache = _FakeAsyncRedis()
    rewrite, embed_patch, search, generate = _pipeline_patches("로그인 API 구현 업무의 마감일은?")

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=cache,
        ),
        rewrite,
        embed_patch,
        search,
        generate,
    ):
        await answer_question(
            object(), project_id=5, question="그 업무는 언제까지야?", history=_MULTITURN_HISTORY
        )

    assert cache.set_calls[0][0] == _answer_cache_key(5, None, "로그인 API 구현 업무의 마감일은?")


@pytest.mark.asyncio
async def test_rewrite_is_skipped_without_history() -> None:
    """히스토리가 없으면 재작성 LLM을 호출하지 않아 첫 질문이 이유 없이 느려지지 않는다."""
    rewrite, embed_patch, search, generate = _pipeline_patches("사용되지 않아야 함")

    with rewrite as mock_rewrite, embed_patch as embed, search, generate:
        await answer_question(object(), project_id=5, question="내 업무가 뭐야?")

    mock_rewrite.assert_not_awaited()
    assert embed.await_args.args[0] == "내 업무가 뭐야?"


@pytest.mark.asyncio
async def test_project_stats_are_passed_to_the_generator() -> None:
    """검색은 상위 5건만 본다. 집계를 따로 넘기지 않으면 '몇 건이야'에 답할 수 없다."""
    stats = {"total": 20, "by_status": {"blocked": 12}, "blocked_by_assignee": [], "due_soon": 0}

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.fetch_project_stats",
            new=AsyncMock(return_value=stats),
        ) as mock_stats,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="블로커는 12건입니다"),
        ) as mock_generate,
    ):
        await answer_question(object(), project_id=5, question="블로커 몇 건이야?")

    assert mock_stats.await_args.args[1] == 5
    assert mock_generate.await_args.kwargs["stats"] == stats


@pytest.mark.asyncio
async def test_answer_is_generated_even_when_stats_are_unavailable() -> None:
    """집계는 부가 정보다. DB 장애로 못 가져와도 기존 RAG 답변은 그대로 나가야 한다."""
    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.fetch_project_stats",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ) as mock_generate,
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result.answer == "답변"
    assert mock_generate.await_args.kwargs["stats"] is None


@pytest.mark.asyncio
async def test_stats_are_not_queried_on_cache_hit() -> None:
    """집계 SQL은 매 질의에 붙는 비용이다. 캐시 히트면 왕복이 늘지 않아야 한다."""
    cached = RagQueryResponse(answer="캐시된 답변", sources=[]).model_dump_json()
    epoch_key = "rag_epoch:5"
    redis = _FakeAsyncRedis({epoch_key: "1"})
    redis.store[_answer_cache_key(5, None, "질문", "1")] = cached

    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.get_async_redis_client",
            return_value=redis,
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.fetch_project_stats",
            new=AsyncMock(return_value=None),
        ) as mock_stats,
    ):
        result = await answer_question(object(), project_id=5, question="질문")

    assert result.answer == "캐시된 답변"
    mock_stats.assert_not_awaited()


def test_cache_schema_version_matches_the_current_prompt_shape() -> None:
    """답변 내용이 달라지는 변경인데 버전을 안 올리면 TTL 30분 동안 옛 답변이 계속 나간다.

    프롬프트 구성뿐 아니라 검색 방식이 바뀌어도 마찬가지다 - 같은 질문에 다른 근거가
    들어가면 답변도 달라진다.

    이 테스트는 실패하라고 있는 것이다 - 프롬프트나 검색을 건드리면 여기서 걸리고, 그때
    버전을 올렸는지 스스로 확인하게 된다. 값만 고쳐 통과시키지 말 것.
    """
    assert _ANSWER_CACHE_SCHEMA_VERSION == "v14"


@pytest.mark.asyncio
async def test_personal_questions_scope_the_stats_to_the_asker() -> None:
    """개인 집계를 안 넘기면 '내 업무 알려줘'에 모델이 출처 표본을 세어 건수를 지어낸다."""
    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.fetch_project_stats",
            new=AsyncMock(return_value=None),
        ) as mock_stats,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        await answer_question(object(), project_id=5, question="내 업무 알려줘", user_id=7)

    assert mock_stats.await_args.kwargs["assignee_id"] == 7


@pytest.mark.asyncio
async def test_general_questions_do_not_scope_the_stats() -> None:
    with (
        patch(
            "llm_rag_assistant.app.services.chat_service.embed_text",
            new=AsyncMock(return_value=[0.1]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.search_chunks_for_question",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "llm_rag_assistant.app.services.chat_service.fetch_project_stats",
            new=AsyncMock(return_value=None),
        ) as mock_stats,
        patch(
            "llm_rag_assistant.app.services.chat_service.generate_answer",
            new=AsyncMock(return_value="답변"),
        ),
    ):
        await answer_question(object(), project_id=5, question="블로커 몇 건이야?", user_id=7)

    assert mock_stats.await_args.kwargs["assignee_id"] is None


def test_answer_cache_key_separates_generation_providers() -> None:
    """프로바이더를 바꾸면 답변 내용이 달라진다. 키가 같으면 로컬(ollama)로 만든 답변이
    HF로 되돌린 뒤에도 TTL 동안 그대로 나간다(반대도 마찬가지)."""
    with patch(
        "llm_rag_assistant.app.services.chat_service.resolve_generation_provider",
        return_value="ollama",
    ):
        local_key = _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문")

    with patch(
        "llm_rag_assistant.app.services.chat_service.resolve_generation_provider",
        return_value="huggingface",
    ):
        hosted_key = _answer_cache_key(project_id=5, assignee_id=None, question="동일 질문")

    assert local_key != hosted_key
