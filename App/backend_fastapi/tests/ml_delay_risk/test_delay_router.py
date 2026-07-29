"""UT-161/UT-166: 지연 위험도 엔드포인트의 준비 상태와 모델 부재 처리.

delay_model 쪽 테스트는 아티팩트가 없을 때 load_artifact가 FileNotFoundError를 던진다는 것까지
확인한다. 하지만 그 예외가 HTTP 응답으로 어떻게 바뀌는지는 라우터에만 있다. 이 구간이 비어 있으면
모델 파일을 못 받은 배포에서 500과 함께 스택트레이스가 나가거나, 더 나쁘게는 임의의 결과가
"예측"으로 화면에 뜨는 변경이 들어와도 알아챌 방법이 없다.
"""
from __future__ import annotations

import lightgbm as lgb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ml_delay_risk.models import delay_model
from ml_delay_risk.routers.delay_router import router
from ml_delay_risk.services import delay_service


def _pending_tasks_df() -> pd.DataFrame:
    return pd.DataFrame([{
        "task_id": 5, "project_id": 1, "milestone_id": float("nan"),
        "title": "결제 시스템 연동", "category": "백엔드", "status": "inprogress",
        "assignee_id": 4, "due_date": pd.NaT, "priority": "높음",
        "created_at": pd.Timestamp(2026, 7, 1, 9, 0, 0),
        "updated_at": pd.Timestamp(2026, 7, 10, 9, 0, 0),
        "milestone_due_date": pd.NaT, "checklist_total": 4, "checklist_done": 1,
    }])


@pytest.fixture(autouse=True)
def _reset_artifact_cache():
    original = delay_model._artifact_cache
    delay_model._artifact_cache = None
    yield
    delay_model._artifact_cache = original


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _fake_artifact() -> delay_model.ModelArtifact:
    train_x = pd.DataFrame({"elapsed_hours_at_cutoff": [1.0, 10.0, 40.0, 80.0]})
    booster = lgb.train(
        {"objective": "multiclass", "num_class": 3, "verbosity": -1,
         "min_data_in_leaf": 1, "min_data_in_bin": 1},
        lgb.Dataset(train_x, label=[0, 0, 1, 2]),
        num_boost_round=3,
    )
    return delay_model.ModelArtifact(
        booster=booster,
        feature_names=["elapsed_hours_at_cutoff"],
        categorical_columns=[],
        frequency_maps={},
        proxy_deadline_map={},
        global_median_duration_hours=72.0,
    )


def test_health_reports_model_loaded_when_the_artifact_is_available(client, monkeypatch):
    """UT-161. 모델이 준비되면 model_loaded=true."""
    monkeypatch.setattr(delay_model, "load_artifact", lambda: _fake_artifact())

    body = client.get("/ai/predict/delay/health").json()

    assert body["status"] == "UP"
    assert body["model_loaded"] is True


def test_health_reports_model_missing_without_failing_the_healthcheck(client, tmp_path, monkeypatch):
    """UT-161의 반대편. 모델이 없어도 health 자체는 200으로 응답하고 model_loaded=false로 알린다.

    이 대조군이 없으면 model_loaded를 상수 true로 바꿔도 위 테스트는 그대로 통과한다 - 모델을
    못 받은 인스턴스가 정상으로 보고되어 배포 사고를 그대로 지나친다.
    """
    monkeypatch.setattr(delay_model, "_model_path", lambda: tmp_path / "missing.pkl")

    response = client.get("/ai/predict/delay/health")

    assert response.status_code == 200
    assert response.json()["model_loaded"] is False


def test_predict_returns_503_and_no_results_when_the_model_file_is_missing(client, tmp_path, monkeypatch):
    """UT-166. 모델이 없으면 503으로 명시하고, 결과를 지어내지 않는다.

    DB 조회는 목으로 막는다. 막지 않으면 이 테스트가 실제 DATABASE_URL에 붙어버려서, 로컬에
    DB가 있느냐 없느냐에 따라 결과가 달라진다(처음 작성했을 때 실제로 그렇게 통과했다).
    """
    monkeypatch.setattr(delay_model, "_model_path", lambda: tmp_path / "missing.pkl")
    monkeypatch.setattr(delay_service, "get_engine", lambda: object())
    monkeypatch.setattr(delay_service, "load_tasks_for_project", lambda project_id, engine: _pending_tasks_df())
    monkeypatch.setattr(delay_service, "load_task_comments_for_project", lambda project_id, engine: pd.DataFrame())
    monkeypatch.setattr(delay_service, "load_task_activities_for_project", lambda project_id, engine: pd.DataFrame())

    response = client.post("/ai/predict/delay/tasks/predict", params={"project_id": 1})

    assert response.status_code == 503
    # 200 + 빈 결과로 응답하면 프론트가 "위험 업무 없음"으로 표시해 사용자를 오도한다.
    assert "results" not in response.json()
