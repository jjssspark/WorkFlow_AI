from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from core.config import Settings, get_settings
from core.db import get_pool
from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse


def _override_pool() -> None:
    async def _fake_pool():
        yield object()

    app.dependency_overrides[get_pool] = _fake_pool


def _override_settings(internal_key: str | None) -> None:
    def _settings() -> Settings:
        return Settings(database_url="postgresql://test", rag_internal_api_key=internal_key)

    app.dependency_overrides[get_settings] = _settings


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_query_endpoint_rejects_request_without_internal_api_key_header() -> None:
    _override_pool()
    _override_settings("expected-secret")

    client = TestClient(app)
    response = client.post("/ai/rag/query", json={"project_id": 1, "question": "질문"})

    assert response.status_code == 401


def test_query_endpoint_rejects_request_with_wrong_internal_api_key() -> None:
    _override_pool()
    _override_settings("expected-secret")

    client = TestClient(app)
    response = client.post(
        "/ai/rag/query",
        json={"project_id": 1, "question": "질문"},
        headers={"X-Internal-Api-Key": "wrong-secret"},
    )

    assert response.status_code == 401


def test_query_endpoint_rejects_all_requests_when_internal_api_key_unconfigured() -> None:
    """공유 시크릿이 설정되지 않은 채 배포되면 보호가 조용히 꺼지는 대신 요청을 전부 거부해야 한다."""
    _override_pool()
    _override_settings(None)

    client = TestClient(app)
    response = client.post(
        "/ai/rag/query",
        json={"project_id": 1, "question": "질문"},
        headers={"X-Internal-Api-Key": ""},
    )

    assert response.status_code == 401


def test_query_endpoint_accepts_request_with_matching_internal_api_key() -> None:
    _override_pool()
    _override_settings("expected-secret")
    fake_result = RagQueryResponse(answer="답변", sources=[])

    with patch(
        "llm_rag_assistant.app.routers.chat_router.enqueue_and_wait",
        new=AsyncMock(return_value=fake_result),
    ):
        client = TestClient(app)
        response = client.post(
            "/ai/rag/query",
            json={"project_id": 1, "question": "질문"},
            headers={"X-Internal-Api-Key": "expected-secret"},
        )

    assert response.status_code == 200
