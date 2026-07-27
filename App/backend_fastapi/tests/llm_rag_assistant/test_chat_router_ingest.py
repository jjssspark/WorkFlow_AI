from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from core.db import get_pool
from llm_rag_assistant.app.schema.chat_schema import RagIngestResponse
from llm_rag_assistant.app.security import verify_internal_api_key


def _override_pool():
    async def _fake_pool():
        yield object()

    app.dependency_overrides[get_pool] = _fake_pool
    app.dependency_overrides[verify_internal_api_key] = lambda: None


def test_ingest_endpoint_returns_chunk_ids() -> None:
    _override_pool()

    fake_result = RagIngestResponse(chunk_ids=[1, 2], chunk_count=2)
    with patch(
        "llm_rag_assistant.app.routers.chat_router.ingest_content",
        new=AsyncMock(return_value=fake_result),
    ):
        client = TestClient(app)
        response = client.post(
            "/ai/rag/ingest",
            json={
                "project_id": 1,
                "source_type": "meeting",
                "source_id": 10,
                "content": "회의록 텍스트",
            },
        )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"chunk_ids": [1, 2], "chunk_count": 2}


def test_ingest_endpoint_rejects_blank_content_without_calling_service() -> None:
    """빈 콘텐츠는 422로 거부하고 인덱싱 서비스를 아예 부르지 않아야 한다.

    통과시키면 서비스의 선삭제만 실행돼 해당 문서가 RAG에서 사라진다. 삭제 의도는
    /delete-source로 명시해야 한다.
    """
    _override_pool()

    with patch(
        "llm_rag_assistant.app.routers.chat_router.ingest_content",
        new=AsyncMock(return_value=RagIngestResponse(chunk_ids=[], chunk_count=0)),
    ) as mock_ingest:
        client = TestClient(app)
        responses = [
            client.post(
                "/ai/rag/ingest",
                json={"project_id": 1, "source_type": "meeting", "source_id": 10, "content": content},
            )
            for content in ("", "   ", "\n\t ")
        ]

    app.dependency_overrides.clear()
    assert [response.status_code for response in responses] == [422, 422, 422]
    mock_ingest.assert_not_awaited()


def test_assignee_sync_endpoint_calls_sync_assignee_with_request_fields() -> None:
    _override_pool()

    with patch(
        "llm_rag_assistant.app.routers.chat_router.sync_assignee",
        new=AsyncMock(return_value=None),
    ) as mock_sync:
        client = TestClient(app)
        response = client.post(
            "/ai/rag/assignee-sync",
            json={"project_id": 1, "source_type": "task", "source_id": 7, "assignee_id": 99},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 204
    _, called_args, _ = mock_sync.mock_calls[0]
    assert called_args[1:] == (1, "task", 7, 99)


def test_delete_source_endpoint_removes_matching_rag_source() -> None:
    _override_pool()

    with patch(
        "llm_rag_assistant.app.routers.chat_router.delete_source",
        new=AsyncMock(return_value=None),
    ) as mock_delete:
        client = TestClient(app)
        response = client.delete("/ai/rag/projects/1/sources/task/7")

    app.dependency_overrides.clear()
    assert response.status_code == 204
    _, called_args, _ = mock_delete.mock_calls[0]
    assert called_args[1:] == (1, "task", 7)


def test_delete_project_sources_endpoint_removes_all_project_rag_data() -> None:
    _override_pool()

    with patch(
        "llm_rag_assistant.app.routers.chat_router.delete_project_sources",
        new=AsyncMock(return_value=None),
    ) as mock_delete:
        client = TestClient(app)
        response = client.delete("/ai/rag/projects/1/sources")

    app.dependency_overrides.clear()
    assert response.status_code == 204
    _, called_args, _ = mock_delete.mock_calls[0]
    assert called_args[1:] == (1,)
