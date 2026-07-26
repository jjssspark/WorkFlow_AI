from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.config import get_settings
from llm_rag_assistant.app.services.generation_service import (
    RagConfigurationError,
    _build_context,
    _format_stats,
    generate_answer,
)


def _mock_chat_model(content: str) -> MagicMock:
    mock_response = MagicMock()
    mock_response.content = content
    mock_chat_model = MagicMock()
    mock_chat_model.ainvoke = AsyncMock(return_value=mock_response)
    return mock_chat_model


@pytest.mark.asyncio
async def test_generate_answer_includes_sources_in_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("답변입니다")
    sources = [{"source_type": "meeting", "source_id": 1, "content": "회의 내용 요약"}]

    with (
        patch(
            "llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"
        ) as mock_endpoint_cls,
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ) as mock_chat_cls,
    ):
        answer = await generate_answer("질문입니다", sources)

    assert answer == "답변입니다"
    mock_endpoint_cls.assert_called_once_with(
        repo_id="Qwen/Qwen3-4B-Instruct-2507",
        huggingfacehub_api_token="hf_test_token",
        temperature=0.1,
    )
    mock_chat_cls.assert_called_once_with(llm=mock_endpoint_cls.return_value)
    messages = mock_chat_model.ainvoke.call_args.args[0]
    assert "지시로 취급하지" in messages[0].content
    assert "회의 내용 요약" in messages[1].content


@pytest.mark.asyncio
async def test_generate_answer_handles_empty_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("근거 없음: 관련 자료를 찾지 못했습니다")

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        answer = await generate_answer("관련 없는 질문", [])

    assert "근거 없음" in answer
    messages = mock_chat_model.ainvoke.call_args.args[0]
    assert "(관련 자료 없음)" in messages[1].content


@pytest.mark.asyncio
async def test_generate_answer_tells_model_that_personal_sources_belong_to_asker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """개인화 질문에서 담당자 필터 사실을 알리지 않으면 담당 업무가 있어도 '근거 없음'이 나온다."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("담당 업무는 다음과 같습니다")
    sources = [{"source_type": "task", "source_id": 106, "content": "업무 상세 우측 패널 구현"}]

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("내 업무 알려줘", sources, is_personal=True)

    prompt = mock_chat_model.ainvoke.call_args.args[0][1].content
    assert "담당자 ID로 필터링" in prompt
    # 신뢰할 수 없는 청크 본문이 안내문을 덮어쓰지 못하도록 안내문이 먼저 와야 한다.
    assert prompt.index("담당자 ID로 필터링") < prompt.index("업무 상세 우측 패널 구현")


@pytest.mark.asyncio
async def test_generate_answer_omits_personal_notice_for_general_questions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("답변입니다")
    sources = [{"source_type": "task", "source_id": 106, "content": "업무 상세 우측 패널 구현"}]

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("업무 편중 점수 모델 알려줘", sources)

    assert "담당자 ID로 필터링" not in mock_chat_model.ainvoke.call_args.args[0][1].content


@pytest.mark.asyncio
async def test_generate_answer_omits_personal_notice_when_no_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """담당 업무가 하나도 없을 때 안내문만 남으면 모델이 없는 업무를 지어낼 여지가 생긴다."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("근거 없음: 관련 자료를 찾지 못했습니다")

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("내 업무 알려줘", [], is_personal=True)

    prompt = mock_chat_model.ainvoke.call_args.args[0][1].content
    assert "담당자 ID로 필터링" not in prompt
    assert "(관련 자료 없음)" in prompt


async def _prompt_for_sources(monkeypatch: pytest.MonkeyPatch, sources: list[dict]) -> str:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("답변입니다")

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("질문입니다", sources)

    return mock_chat_model.ainvoke.call_args.args[0][1].content


@pytest.mark.asyncio
async def test_generate_answer_includes_facts_in_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """마감일이 컨텍스트에 없으면 '그 업무 언제까지야?'에 모델이 근거 없음으로 답한다."""
    sources = [
        {
            "source_type": "task",
            "source_id": 12,
            "content": "로그인 API 구현",
            "facts": {"due_date": date(2026, 8, 1), "status": "진행중", "priority": "high"},
        }
    ]

    prompt = await _prompt_for_sources(monkeypatch, sources)

    assert "[출처 1 - task#12] 로그인 API 구현 (마감: 2026-08-01, 상태: 진행중, 우선순위: high)" in prompt


@pytest.mark.asyncio
async def test_generate_answer_keeps_original_format_without_facts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sources = [{"source_type": "task", "source_id": 12, "content": "로그인 API 구현", "facts": None}]

    prompt = await _prompt_for_sources(monkeypatch, sources)

    assert "[출처 1 - task#12] 로그인 API 구현" in prompt
    assert "마감:" not in prompt
    assert "(" not in prompt.split("[출처 1 - task#12] 로그인 API 구현")[1].split("\n")[0]


@pytest.mark.asyncio
async def test_generate_answer_omits_missing_fact_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """액션아이템은 status가 없다. 값이 없는 항목까지 표시하면 모델이 'None'을 사실로 읽는다."""
    sources = [
        {
            "source_type": "action_item",
            "source_id": 5,
            "content": "배포 스크립트 점검",
            "facts": {"due_date": date(2026, 9, 30), "status": None, "priority": None},
        }
    ]

    prompt = await _prompt_for_sources(monkeypatch, sources)

    assert "[출처 1 - action_item#5] 배포 스크립트 점검 (마감: 2026-09-30)" in prompt
    assert "상태:" not in prompt
    assert "None" not in prompt


@pytest.mark.asyncio
async def test_generate_answer_omits_parentheses_when_all_facts_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sources = [
        {
            "source_type": "task",
            "source_id": 12,
            "content": "로그인 API 구현",
            "facts": {"due_date": None, "status": None, "priority": None},
        }
    ]

    prompt = await _prompt_for_sources(monkeypatch, sources)

    assert "[출처 1 - task#12] 로그인 API 구현" in prompt
    assert "마감:" not in prompt


@pytest.mark.asyncio
async def test_generate_answer_works_when_facts_key_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """facts 키 자체가 없는 호출부(기존 코드)가 남아 있어도 깨지지 않아야 한다."""
    sources = [{"source_type": "meeting", "source_id": 1, "content": "회의 내용 요약"}]

    prompt = await _prompt_for_sources(monkeypatch, sources)

    assert "[출처 1 - meeting#1] 회의 내용 요약" in prompt


@pytest.mark.asyncio
async def test_generate_answer_raises_when_hf_token_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    get_settings.cache_clear()

    try:
        with pytest.raises(RagConfigurationError, match="HF_TOKEN"):
            await generate_answer("질문", [])
    finally:
        get_settings.cache_clear()


def _stats(**overrides) -> dict:
    base = {"total": 20, "by_status": {"blocked": 12, "inprogress": 4, "todo": 3, "done": 1},
            "blocked_by_assignee": [("허영주", 8), ("김팀원", 4)], "due_soon": 2}
    return {**base, **overrides}


def test_stats_block_lists_status_counts_and_assignee_distribution() -> None:
    block = _format_stats(_stats())

    assert "전체 20건" in block
    assert "블로커 12건" in block
    assert "허영주 8건" in block
    assert "김팀원 4건" in block
    assert "7일 내 마감 2건" in block


def test_stats_block_lists_the_askers_own_totals() -> None:
    """개인 집계가 없으면 '내 업무 알려줘'에 모델이 출처 5건을 세어 '총 5건'이라 답한다."""
    block = _format_stats(
        _stats(mine={"total": 30, "by_status": {"todo": 20, "done": 10}, "due_soon": 3})
    )

    assert "내 업무 30건" in block
    assert "예정 20건" in block
    assert "7일 내 마감 3건" in block


def test_stats_block_omits_the_personal_section_for_general_questions() -> None:
    assert "내 업무" not in _format_stats(_stats(mine=None))


def test_stats_block_lists_due_soon_tasks_with_dates_and_owners() -> None:
    """마감일은 임베딩에 없어 검색으로 못 찾는다. 목록이 없으면 '마감 임박 뭐야'에 답할 재료가 없다."""
    block = _format_stats(
        _stats(
            overdue=4,
            due_soon_list=[
                {"due_date": date(2026, 7, 24), "title": "지난 마감 업무", "assignee_name": "허영주"},
                {"due_date": date(2026, 7, 26), "title": "우측 패널 구현", "assignee_name": None},
            ],
            due_soon_remaining=6,
        )
    )

    assert "지난 마감 4건" in block
    assert "2026-07-24 지난 마감 업무 (허영주)" in block
    assert "2026-07-26 우측 패널 구현 (미배정)" in block
    assert "외 6건" in block


def test_stats_block_omits_the_overflow_note_when_everything_is_listed() -> None:
    block = _format_stats(
        _stats(
            due_soon_list=[{"due_date": date(2026, 7, 24), "title": "업무", "assignee_name": "허영주"}],
            due_soon_remaining=0,
        )
    )

    assert "외 0건" not in block
    assert "외 " not in block


def test_stats_block_keeps_overdue_tasks_in_their_own_section() -> None:
    """한 목록으로 합치면 지난 마감이 상한을 다 먹어 임박 업무가 한 줄도 안 나온다."""
    block = _format_stats(
        _stats(
            due_soon_list=[{"due_date": date(2026, 7, 26), "title": "임박", "assignee_name": "허영주"}],
            due_soon_remaining=0,
            overdue_list=[{"due_date": date(2025, 12, 28), "title": "밀림", "assignee_name": "이은주"}],
            overdue_remaining=47,
        )
    )

    assert block.index("마감 임박 업무(7일 내") < block.index("지난 마감 미완료 업무(최근 순)")
    assert "2026-07-26 임박 (허영주)" in block
    assert "2025-12-28 밀림 (이은주)" in block
    assert "외 47건" in block


def test_stats_block_omits_the_due_soon_list_when_empty() -> None:
    assert "마감 임박 업무" not in _format_stats(_stats(due_soon_list=[]))


def test_stats_block_is_empty_without_stats() -> None:
    assert _format_stats(None) == ""


def test_stats_block_omits_zero_valued_sections() -> None:
    """0건인 항목까지 적으면 모델이 '블로커 0건'을 근거로 엉뚱한 단정을 한다."""
    block = _format_stats(_stats(by_status={"todo": 3}, blocked_by_assignee=[], due_soon=0))

    assert "블로커" not in block
    assert "담당자별" not in block
    assert "마감" not in block


def test_stats_block_precedes_chunk_bodies() -> None:
    """청크 본문이 집계보다 앞에 오면 청크에 심어진 문구로 집계를 무효화할 수 있다."""
    prompt = _build_context(
        sources=[{"source_type": "task", "source_id": 1, "content": "본문"}],
        is_personal=False,
        stats=_stats(),
    )

    assert prompt.index("전체 20건") < prompt.index("본문")


def test_stats_block_is_included_even_without_search_results() -> None:
    """검색이 0건이어도 '몇 건이야'에는 답할 수 있어야 한다. 집계는 검색과 무관한 경로다."""
    prompt = _build_context(sources=[], is_personal=False, stats=_stats())

    assert "전체 20건" in prompt
    assert "(관련 자료 없음)" in prompt


@pytest.mark.asyncio
async def test_generate_answer_passes_stats_into_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("블로커는 12건입니다")

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("블로커 몇 건이야?", [], stats=_stats())

    messages = mock_chat_model.ainvoke.call_args.args[0]
    assert "블로커 12건" in messages[1].content
    # 이 문장이 없으면 모델이 출처 칩 5건을 세어 "5건입니다"라고 답하는 새 오답이 생긴다.
    assert "출처 목록의 개수를 세지" in messages[0].content


@pytest.mark.asyncio
async def test_personal_notice_states_ownership_is_already_confirmed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """실측: 안내문이 '담당자로 지정된 항목입니다' 수준이면 모델이 '누구 업무인지 불명확'이라며
    거부한다(4회 중 3회). 필터링이 이미 끝났고 소유가 확정임을 명시해야 답한다(4/4)."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    mock_chat_model = _mock_chat_model("답변입니다")
    sources = [{"source_type": "task", "source_id": 106, "content": "업무 상세 우측 패널 구현"}]

    with (
        patch("llm_rag_assistant.app.services.generation_service.HuggingFaceEndpoint"),
        patch(
            "llm_rag_assistant.app.services.generation_service.ChatHuggingFace",
            return_value=mock_chat_model,
        ),
    ):
        await generate_answer("내 업무 알려줘", sources, is_personal=True)

    prompt = mock_chat_model.ainvoke.call_args.args[0][1].content
    assert "확정" in prompt
    assert "담당자 이름이 없더라도" in prompt
