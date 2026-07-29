from __future__ import annotations

import os
from unittest.mock import patch

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_service import get_workload_score

# LANGSMITH_* 환경변수를 건드리는 테스트가 있으므로, core/tests/test_tracing.py와 동일한
# 패턴으로 각 테스트 전후 관련 환경변수를 정리해 테스트 간 순서 의존적 실패를 막는다.
_LANGSMITH_ENV_VARS = ("LANGSMITH_API_KEY", "LANGSMITH_TRACING", "LANGSMITH_PROJECT")


@pytest.fixture(autouse=True)
def _clean_langsmith_env():
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)
    yield
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)


def _fake_tasks_df() -> pd.DataFrame:
    today = pd.Timestamp("2026-07-16")
    return pd.DataFrame([
        {"task_id": 1, "project_id": 1, "assignee_id": "1", "category": "백엔드",
         "priority": "높음", "status": "할 일", "due_date": today + pd.Timedelta(days=5)},
        {"task_id": 2, "project_id": 1, "assignee_id": "2", "category": "문서",
         "priority": "낮음", "status": "완료", "due_date": today - pd.Timedelta(days=1)},
    ])


def _fake_result_row(**overrides) -> dict:
    base = {
        "assignee_id": "1", "task_count_total": 1, "completion_rate": 0.0,
        "overload_score_0_100": 10.0, "is_anomaly": False, "anomaly_types": [],
        "difficulty_score": 5.0, "workload_score": 5.0, "allocation_score": 5.0,
        "task_count_active_rel": 1.0, "task_count_total_rel": 1.0,
        "difficulty_total_rel": 1.0, "overdue_count": 0,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_get_workload_score_still_calls_build_features_and_detect_through_chain_wrapper():
    """LangChain @chain 래퍼로 감싼 뒤에도 build_features/detect_overload_anomalies_auto가
    실제로 호출되고, 그 반환값이 최종 결과에 그대로 반영되는지 확인한다(체인 래퍼가
    원본 함수 호출을 우회하지 않는지 검증)."""
    tasks_df = _fake_tasks_df()
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=tasks_df,
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features, patch(
        "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
    ) as mock_detect:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row()])
        mock_detect.return_value = pd.DataFrame([_fake_result_row(
            task_count_total=7, completion_rate=0.9,
        )])
        mock_detect.return_value.attrs = {"method_used": "MAD (소규모 팀)"}

        result = await get_workload_score(project_id=1)

    mock_build_features.assert_called_once_with(tasks_df)
    mock_detect.assert_called_once()
    assert result.members[0].task_count_total == 7
    assert result.members[0].completion_rate == pytest.approx(0.9)
    assert result.method == "MAD (소규모 팀)"


@pytest.mark.asyncio
async def test_get_workload_score_works_without_langsmith_api_key(monkeypatch):
    """LANGSMITH_API_KEY가 없어도(테스트 환경 기본 상태) 트레이싱은 조용히 비활성화될 뿐
    파이프라인 자체는 정상 동작해야 한다."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)

    result = await get_workload_score(project_id=1, use_synthetic_fallback=True)

    assert result.source == "synthetic_fallback"
    assert len(result.members) > 0


def test_workload_service_module_imports_chain_from_langchain_core():
    """이 모듈이 실제로 langchain_core.runnables.chain을 사용하고 있는지 정적으로 확인한다."""
    import ml_workload_score.app.services.workload_service as svc

    assert hasattr(svc, "chain")
