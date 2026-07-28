from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from core.config import Settings, get_settings


def _override_settings(internal_key: str | None) -> None:
    def _settings() -> Settings:
        return Settings(database_url="postgresql://test", rag_internal_api_key=internal_key)

    app.dependency_overrides[get_settings] = _settings


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_predict_tasks_rejects_request_without_internal_api_key_header() -> None:
    _override_settings("expected-secret")

    client = TestClient(app)
    response = client.post("/ai/predict/delay/tasks/predict", params={"project_id": 1})

    assert response.status_code == 401


def test_predict_tasks_rejects_request_with_wrong_internal_api_key() -> None:
    _override_settings("expected-secret")

    client = TestClient(app)
    response = client.post(
        "/ai/predict/delay/tasks/predict",
        params={"project_id": 1},
        headers={"X-Internal-Api-Key": "wrong-secret"},
    )

    assert response.status_code == 401


def test_predict_tasks_rejects_all_requests_when_internal_api_key_unconfigured() -> None:
    """공유 시크릿이 설정되지 않은 채 배포되면 보호가 조용히 꺼지는 대신 요청을 전부 거부해야 한다."""
    _override_settings(None)

    client = TestClient(app)
    response = client.post(
        "/ai/predict/delay/tasks/predict",
        params={"project_id": 1},
        headers={"X-Internal-Api-Key": ""},
    )

    assert response.status_code == 401


def test_predict_tasks_accepts_request_with_matching_internal_api_key() -> None:
    _override_settings("expected-secret")

    with patch(
        "ml_delay_risk.routers.delay_router.run_delay_risk_for_project",
        return_value=[],
    ):
        client = TestClient(app)
        response = client.post(
            "/ai/predict/delay/tasks/predict",
            params={"project_id": 1},
            headers={"X-Internal-Api-Key": "expected-secret"},
        )

    assert response.status_code == 200
