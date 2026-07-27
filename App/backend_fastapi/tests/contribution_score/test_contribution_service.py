from __future__ import annotations

import pytest

from contribution_score.app.services.contribution_service import (
    compute_contribution_scores,
    meeting_component_of,
    workload_component_of,
)
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult


def _member(assignee_id="1", completion_rate=0.5, overload_score=0.0, anomaly_type="정상") -> WorkloadMemberResult:
    return WorkloadMemberResult(
        assignee_id=assignee_id,
        task_count_total=10,
        completion_rate=completion_rate,
        overload_score=overload_score,
        is_anomaly=anomaly_type != "정상",
        anomaly_type=anomaly_type,
        task_count_active_rel=1.2,
        task_count_total_rel=1.2,
        difficulty_avg_rel=1.1,
        overdue_count=1,
    )


def test_workload_component_penalizes_workload_imbalance():
    member = _member(overload_score=82.5, anomaly_type="배정량 불균형")
    assert workload_component_of(member) == pytest.approx(17.5)


def test_workload_component_does_not_penalize_overload():
    member = _member(overload_score=82.5, anomaly_type="과부하 의심")
    assert workload_component_of(member) == 100.0


def test_workload_component_normal_is_full_score():
    member = _member(overload_score=5.0, anomaly_type="정상")
    assert workload_component_of(member) == 100.0


def test_workload_component_clamps_at_zero_for_extreme_outlier():
    member = _member(overload_score=150.0, anomaly_type="배정량 불균형")
    assert workload_component_of(member) == 0.0


def test_meeting_component_no_meetings_held_is_full_score():
    assert meeting_component_of(attended=0, total=0) == 100.0


def test_meeting_component_partial_attendance():
    assert meeting_component_of(attended=3, total=4) == 75.0


def test_meeting_component_full_attendance():
    assert meeting_component_of(attended=5, total=5) == 100.0


def test_compute_contribution_scores_missing_attendance_defaults_to_zero():
    from contribution_score.app.services import contribution_service as svc

    members = [_member(assignee_id="9", completion_rate=0.8, overload_score=0.0, anomaly_type="정상")]
    results = compute_contribution_scores(members, attendance={}, total_meetings=4)

    assert len(results) == 1
    result = results[0]
    assert result.assignee_id == "9"
    assert result.workload_component == 100.0
    assert result.task_component == 80.0
    assert result.meeting_component == 0.0
    # 균등 가중치가 아니라 Task 4에서 반영한 엔트로피 실험 가중치를 사용한 기대값.
    expected = svc.WEIGHT_WORKLOAD * 100.0 + svc.WEIGHT_TASK * 80.0 + svc.WEIGHT_MEETING * 0.0
    assert result.contribution_score == pytest.approx(expected, abs=0.1)
    assert result.anomaly_type == "정상"
    assert result.task_count_active_rel == pytest.approx(1.2)
    assert result.task_count_total_rel == pytest.approx(1.2)
    assert result.difficulty_avg_rel == pytest.approx(1.1)
    assert result.overdue_count == 1


def test_compute_contribution_scores_uses_experiment_derived_weights():
    from contribution_score.app.services import contribution_service as svc

    total = svc.WEIGHT_WORKLOAD + svc.WEIGHT_TASK + svc.WEIGHT_MEETING
    assert total == pytest.approx(1.0)
    assert svc.WEIGHT_WORKLOAD == pytest.approx(0.2016)
    assert svc.WEIGHT_TASK == pytest.approx(0.4911)
    assert svc.WEIGHT_MEETING == pytest.approx(0.3073)
