from __future__ import annotations

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_model import build_features


def _sample_tasks_df() -> pd.DataFrame:
    today = pd.Timestamp("2026-07-16")
    return pd.DataFrame([
        {"task_id": 1, "project_id": 1, "assignee_id": "a", "category": "백엔드",
         "priority": "높음", "status": "할 일", "due_date": today + pd.Timedelta(days=5)},
        {"task_id": 2, "project_id": 1, "assignee_id": "a", "category": "문서",
         "priority": "낮음", "status": "완료", "due_date": today - pd.Timedelta(days=1)},
    ])


def test_build_features_without_embedding_adjustments_unchanged():
    """embedding_adjustments를 안 넘기면 기존과 완전히 동일하게 동작해야 한다(회귀 없음)."""
    df = _sample_tasks_df()
    features_without_arg = build_features(df)
    features_with_none = build_features(df, embedding_adjustments=None)
    pd.testing.assert_frame_equal(features_without_arg, features_with_none)


def test_build_features_applies_embedding_adjustments():
    df = _sample_tasks_df()
    baseline = build_features(df)
    baseline_difficulty = baseline.loc[baseline["assignee_id"] == "a", "difficulty_total"].iloc[0]

    # task_id=1에 +1.0 보정치를 주면 difficulty_total이 그만큼 그대로 올라가야 함
    # (합산 집계이므로 개별 task의 보정치가 팀원 수로 나눠지지 않고 직접 반영됨 —
    # 평균 집계였던 시절엔 팀원당 task 2개 중 1개라 절반(0.5)만 반영됐었음)
    adjusted = build_features(df, embedding_adjustments={1: 1.0})
    adjusted_difficulty = adjusted.loc[adjusted["assignee_id"] == "a", "difficulty_total"].iloc[0]

    assert adjusted_difficulty == pytest.approx(baseline_difficulty + 1.0)


def test_build_features_missing_task_id_in_adjustments_defaults_to_zero():
    df = _sample_tasks_df()
    baseline = build_features(df)
    adjusted = build_features(df, embedding_adjustments={999: 5.0})  # 존재하지 않는 task_id
    pd.testing.assert_frame_equal(baseline, adjusted)
