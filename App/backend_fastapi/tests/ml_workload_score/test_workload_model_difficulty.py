from __future__ import annotations

from inspect import signature

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_model import build_features


def _sample_tasks_df() -> pd.DataFrame:
    today = pd.Timestamp("2026-07-16")
    return pd.DataFrame([
        {
            "task_id": 1,
            "project_id": 1,
            "assignee_id": "a",
            "category": "백엔드",
            "priority": "높음",
            "status": "할 일",
            "due_date": today + pd.Timedelta(days=5),
        },
        {
            "task_id": 2,
            "project_id": 1,
            "assignee_id": "a",
            "category": "문서",
            "priority": "낮음",
            "status": "완료",
            "due_date": today - pd.Timedelta(days=1),
        },
    ])


def test_build_features_uses_priority_and_category_difficulty_only() -> None:
    features = build_features(_sample_tasks_df())

    # 높음(3) + 백엔드(0.5), 낮음(1) + 문서(-0.5)의 평균
    assert features.loc[0, "difficulty_avg"] == pytest.approx(2.0)


def test_build_features_does_not_accept_external_difficulty_adjustments() -> None:
    assert set(signature(build_features).parameters) == {"tasks_df", "today"}
