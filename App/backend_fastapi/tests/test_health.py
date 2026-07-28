from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ok_with_service_status() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "workflow-ai-fastapi"
    assert body["status"] == "UP"
