from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from ml_workload_score.app.schema.workload_schema import (
    WorkloadMemberResult,
    WorkloadScoreData,
)

client = TestClient(app)


def test_score_workload_returns_success_when_service_succeeds() -> None:
    fake_result = WorkloadScoreData(
        project_id=1,
        source="db",
        method="MAD (소규모 팀)",
        members=[
            WorkloadMemberResult(
                assignee_id="3",
                task_count_total=10,
                completion_rate=0.4,
                overload_score=82.5,
                is_anomaly=True,
                anomaly_type="과부하 의심",
                task_count_active_rel=1.8,
                task_count_total_rel=1.8,
                difficulty_avg_rel=1.4,
                overdue_count=2,
            )
        ],
    )
    with patch(
        "ml_workload_score.app.routers.workload_router.get_workload_score",
        new=AsyncMock(return_value=fake_result),
    ) as mock_get_score:
        response = client.post("/ai/score/workload", params={"project_id": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["members"][0]["assignee_id"] == "3"
    assert body["data"]["schema_version"] == "1.0"
    mock_get_score.assert_awaited_once_with(1, use_synthetic_fallback=False)


def test_score_workload_returns_500_with_error_envelope_when_service_raises() -> None:
    with patch(
        "ml_workload_score.app.routers.workload_router.get_workload_score",
        new=AsyncMock(side_effect=RuntimeError("db unreachable")),
    ):
        response = client.post("/ai/score/workload", params={"project_id": 1})

    assert response.status_code == 500
    assert response.json()["detail"]["error"]["code"] == "WORKLOAD_SCORE_FAILED"


def test_score_workload_synthetic_fallback_smoke() -> None:
    """모킹 없는 엔드투엔드 스모크 테스트: 실제 DB 연결 정보가 없어도
    get_workload_score()가 synthetic fallback으로 정상 동작하는지 확인한다."""
    response = client.post(
        "/ai/score/workload",
        params={"project_id": 1, "use_synthetic_fallback": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["source"] in ("db", "synthetic_fallback")
    assert body["data"]["schema_version"] == "1.0"
    assert len(body["data"]["members"]) > 0
