from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_service import (
    get_workload_score,
)


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
async def test_get_workload_score_builds_features_from_database_tasks_only():
    tasks_df = _fake_tasks_df()
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=tasks_df,
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row()])
        with patch(
            "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
        ) as mock_detect:
            mock_detect.return_value = mock_build_features.return_value
            mock_detect.return_value.attrs = {"method_used": "MAD"}
            await get_workload_score(project_id=1)

    args, kwargs = mock_build_features.call_args
    assert args == (tasks_df,)
    assert kwargs == {}


@pytest.mark.asyncio
async def test_get_workload_score_synthetic_fallback_still_works():
    """DB 조회 실패 시 synthetic fallback 경로가 외부 모델 없이 동작해야 한다."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        side_effect=RuntimeError("no db"),
    ):
        result = await get_workload_score(project_id=1, use_synthetic_fallback=True)

    assert result.source == "synthetic_fallback"
    assert len(result.members) > 0


@pytest.mark.asyncio
async def test_get_workload_score_includes_workload_evidence_fields():
    """편중도 근거 패널이 필요로 하는 필드들이 응답까지 그대로 전달되는지 확인한다."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=_fake_tasks_df(),
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row(
            task_count_total=4, completion_rate=0.5, overload_score_0_100=82.5,
            is_anomaly=True, anomaly_types=["업무량 편중 의심"],
            task_count_active_rel=1.8, task_count_total_rel=1.8,
            difficulty_total_rel=1.4, overdue_count=2,
        )])
        with patch(
            "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
        ) as mock_detect:
            mock_detect.return_value = mock_build_features.return_value
            mock_detect.return_value.attrs = {"method_used": "MAD"}
            result = await get_workload_score(project_id=1)

    member = result.members[0]
    assert member.task_count_active_rel == pytest.approx(1.8)
    assert member.difficulty_total_rel == pytest.approx(1.4)
    assert member.overdue_count == 2
    assert member.anomaly_types == ["업무량 편중 의심"]


@pytest.mark.asyncio
async def test_get_workload_score_passes_team_mean_completion_from_attrs():
    """anomaly_types 판정에 쓰인 실제 팀 평균 완료율이 result.attrs를 거쳐
    응답까지 그대로 전달돼야 한다 - 편중도 근거 패널이 이 값 없이 "팀 평균보다
    높음/낮음"을 단정하면 심사 근거를 오도할 수 있다(리뷰 지적사항)."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=_fake_tasks_df(),
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row(
            task_count_total=4, completion_rate=0.5, overload_score_0_100=82.5,
            is_anomaly=True, anomaly_types=["업무량 편중 의심"],
            task_count_active_rel=1.8, task_count_total_rel=1.8,
            difficulty_total_rel=1.4, overdue_count=2,
        )])
        with patch(
            "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
        ) as mock_detect:
            mock_detect.return_value = mock_build_features.return_value
            mock_detect.return_value.attrs = {"method_used": "MAD", "team_mean_completion": 0.62}
            result = await get_workload_score(project_id=1)

    assert result.team_mean_completion == pytest.approx(0.62)


@pytest.mark.asyncio
async def test_get_workload_score_team_mean_completion_defaults_to_none_when_missing():
    """attrs에 team_mean_completion이 없어도(구버전 호환) 500이 아니라 None으로
    안전하게 폴백해야 한다."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=_fake_tasks_df(),
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row(
            task_count_total=4, completion_rate=0.5, overload_score_0_100=82.5,
            is_anomaly=True, anomaly_types=["업무량 편중 의심"],
            task_count_active_rel=1.8, task_count_total_rel=1.8,
            difficulty_total_rel=1.4, overdue_count=2,
        )])
        with patch(
            "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
        ) as mock_detect:
            mock_detect.return_value = mock_build_features.return_value
            mock_detect.return_value.attrs = {"method_used": "MAD"}
            result = await get_workload_score(project_id=1)

    assert result.team_mean_completion is None
