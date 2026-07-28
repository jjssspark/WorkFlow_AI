from __future__ import annotations

from unittest.mock import AsyncMock, patch

import ollama
import pytest
from fastapi.testclient import TestClient

from app.main import app
from ai_contribution_report.app.schema.contribution_schema import MemberContribution
from core.security import verify_internal_api_key

client = TestClient(app)


@pytest.fixture(autouse=True)
def _bypass_internal_api_key():
    app.dependency_overrides[verify_internal_api_key] = lambda: None
    yield
    app.dependency_overrides.pop(verify_internal_api_key, None)


def test_generate_report_returns_data_when_service_succeeds():
    fake_result = [MemberContribution(user_id=1, name="김민준", summary="요약", evidence=["To-Do 8/10건 완료"])]
    with patch(
        "ai_contribution_report.app.routers.contribution_router.generate_contribution_reports",
        new=AsyncMock(return_value=fake_result),
    ) as mock_generate:
        response = client.post("/ai/report/contribution", json={"project_id": 1})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["user_id"] == 1
    assert body[0]["name"] == "김민준"
    mock_generate.assert_awaited_once_with(1)


def test_generate_report_returns_500_with_error_envelope_when_service_raises():
    with patch(
        "ai_contribution_report.app.routers.contribution_router.generate_contribution_reports",
        new=AsyncMock(side_effect=RuntimeError("db unreachable")),
    ):
        response = client.post("/ai/report/contribution", json={"project_id": 1})

    assert response.status_code == 500
    assert response.json()["detail"]["error"]["code"] == "CONTRIBUTION_REPORT_FAILED"


def test_generate_report_returns_503_when_llm_unavailable():
    with patch(
        "ai_contribution_report.app.routers.contribution_router.generate_contribution_reports",
        new=AsyncMock(side_effect=ollama.ResponseError("connection refused")),
    ):
        response = client.post("/ai/report/contribution", json={"project_id": 1})

    assert response.status_code == 503
    assert response.json()["detail"]["error"]["code"] == "CONTRIBUTION_LLM_UNAVAILABLE"
