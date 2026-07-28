from __future__ import annotations

from unittest.mock import AsyncMock, patch

import aiohttp
import pytest
import requests
from fastapi.testclient import TestClient

from app.main import app
from core.db import get_pool
from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse, RagSource
from llm_rag_assistant.app.security import verify_internal_api_key
from llm_rag_assistant.app.services.generation_service import RagConfigurationError
from llm_rag_assistant.app.services.rag_queue_service import RagQueueFullError, RagQueueTimeoutError


def _override_pool():
    async def _fake_pool():
        yield object()

    app.dependency_overrides[get_pool] = _fake_pool
    app.dependency_overrides[verify_internal_api_key] = lambda: None


def test_query_endpoint_returns_answer_with_sources() -> None:
    _override_pool()
    fake_result = RagQueryResponse(
        answer="답변",
        sources=[RagSource(source_type="meeting", source_id=1, content_snippet="요약", similarity=0.9)],
    )
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(return_value=fake_result),
    ) as mock_answer:
        client = TestClient(app)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["answer"] == "답변"
    mock_answer.assert_awaited_once()
    _, called_args, _ = mock_answer.mock_calls[0]
    assert called_args[0] == 1


def test_query_endpoint_forwards_history_to_service() -> None:
    """멀티턴: 요청의 history가 answer_question까지 dict 형태로 전달되고, 없어도 200이다.

    query_rewrite_service._format_history는 turn.get()으로 접근하므로 Pydantic
    모델(RagHistoryMessage)이 아니라 dict여야 한다 - 회귀 방지용 검증.
    """
    _override_pool()
    fake_result = RagQueryResponse(answer="답변", sources=[])
    history = [
        {"role": "user", "content": "내 업무가 뭐야?"},
        {"role": "assistant", "content": "로그인 API 구현 업무가 있습니다"},
    ]
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(return_value=fake_result),
    ) as mock_answer:
        client = TestClient(app)
        response = client.post(
            "/ai/rag/query",
            json={"project_id": 1, "question": "그 업무는 언제까지야?", "history": history},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    passed_history = mock_answer.await_args.kwargs["history"]
    assert passed_history == history
    assert all(isinstance(turn, dict) for turn in passed_history)


def test_query_endpoint_returns_503_when_connection_fails() -> None:
    _override_pool()
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(side_effect=aiohttp.ClientConnectionError("connection refused")),
    ):
        client = TestClient(app)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {"error": "llm_unavailable"}


def test_different_project_ids_are_forwarded_unmodified_to_service() -> None:
    """교차 프로젝트 데이터 노출 방지 회귀 테스트: project_id가 라우터에서
    변조되거나 무시되지 않고 그대로 서비스 계층에 전달되는지 확인한다."""
    _override_pool()
    fake_result = RagQueryResponse(answer="답변", sources=[])

    for project_id in (1, 2, 999):
        with patch(
            "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
            new=AsyncMock(return_value=fake_result),
        ) as mock_answer:
            client = TestClient(app)
            client.post("/ai/rag/query", json={"project_id": project_id, "question": "질문"})
            _, called_args, _ = mock_answer.mock_calls[0]
            assert called_args[0] == project_id

    app.dependency_overrides.clear()


def test_query_endpoint_returns_503_when_huggingface_returns_http_error() -> None:
    _override_pool()
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(side_effect=requests.exceptions.HTTPError("503 Service Unavailable")),
    ):
        client = TestClient(app)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {"error": "llm_unavailable"}


def test_query_endpoint_returns_503_when_hf_token_missing() -> None:
    """generate_answer가 HF_TOKEN 미설정으로 던지는 RagConfigurationError도
    500이 아니라 503(llm_unavailable)로 응답해야 한다 — 설정 오류든 연결 실패든
    클라이언트 입장에서는 동일하게 '지금은 답변 불가' 상태다."""
    _override_pool()
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(side_effect=RagConfigurationError("HF_TOKEN is not configured.")),
    ):
        client = TestClient(app)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {"error": "llm_unavailable"}


@pytest.mark.parametrize(
    "exception",
    [
        RagQueueTimeoutError("RAG 답변 생성이 시간 내에 끝나지 않았습니다."),
        RagQueueFullError("대기 중인 RAG 질의가 너무 많습니다."),
    ],
)
def test_query_endpoint_returns_503_when_queue_cannot_deliver(exception: Exception) -> None:
    """Redis Queue 적재 실패(가득 참)나 워커 응답 대기 시간 초과도 LLM 연결 실패와
    동일하게 503(llm_unavailable)으로 응답해야 한다 - 클라이언트 입장에서는
    "지금은 답변 불가"라는 점이 동일하다."""
    _override_pool()
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(side_effect=exception),
    ):
        client = TestClient(app)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {"error": "llm_unavailable"}


def test_query_endpoint_does_not_mask_unrelated_runtime_errors() -> None:
    """RagConfigurationError가 아닌 일반 RuntimeError(실제 코드 결함)는 503으로
    감추지 않고 500으로 그대로 드러나야 한다 — 설정 오류 전용 예외로 범위를
    좁힌 회귀 테스트. raise_server_exceptions=False로 FastAPI의 기본 500 응답을
    그대로 받는다(기본값이면 TestClient가 예외를 그대로 재발생시켜 테스트가 실패함)."""
    _override_pool()
    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(side_effect=RuntimeError("예상치 못한 내부 오류")),
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    app.dependency_overrides.clear()
    assert response.status_code == 500
