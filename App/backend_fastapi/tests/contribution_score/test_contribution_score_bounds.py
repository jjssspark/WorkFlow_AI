"""UT-204/206: 기여도 점수의 범위 보장과 프로젝트 범위 집계.

기존 test_contribution_service.py는 구성요소 하나씩(workload/meeting)의 동작을 본다. 여기서
보는 것은 그것들을 가중합한 최종 점수가 어떤 입력에서도 0~100을 벗어나지 않는가다. 이 값은
심사자 화면에 그대로 숫자로 뜨고 평가 총점 계산에도 들어가므로, 101점이나 음수가 나오면
그대로 노출된다.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from contribution_score.app.services import contribution_db as cdb
from contribution_score.app.services.contribution_service import (
    WEIGHT_MEETING,
    WEIGHT_TASK,
    WEIGHT_WORKLOAD,
    compute_contribution_scores,
)
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult


def _member(assignee_id: str, completion_rate: float, overload_score: float, anomaly_type: str):
    return WorkloadMemberResult(
        assignee_id=assignee_id,
        task_count_total=1,
        completion_rate=completion_rate,
        overload_score=overload_score,
        is_anomaly=anomaly_type != "정상",
        anomaly_type=anomaly_type,
        task_count_active_rel=1.0,
        task_count_total_rel=1.0,
        difficulty_avg_rel=1.0,
        overdue_count=0,
    )


def test_component_weights_sum_to_one():
    """가중치 합이 1이라는 사실이 점수 상한 100을 보장하는 근거다. 합이 1을 넘으면 모든
    구성요소가 100 이하여도 총점이 100을 넘는다."""
    assert WEIGHT_WORKLOAD + WEIGHT_TASK + WEIGHT_MEETING == pytest.approx(1.0, abs=1e-4)


def test_scores_stay_within_zero_and_hundred_at_both_extremes():
    """UT-204. 최악(아무것도 안 함 + 배정량 불균형)과 최선(전부 완료 + 전원 참석) 양 끝."""
    members = [
        _member("worst", completion_rate=0.0, overload_score=100.0, anomaly_type="배정량 불균형"),
        _member("best", completion_rate=1.0, overload_score=0.0, anomaly_type="정상"),
    ]

    results = compute_contribution_scores(members, attendance={"best": 10}, total_meetings=10)

    scores = {r.assignee_id: r.contribution_score for r in results}
    assert scores["worst"] == 0.0
    assert scores["best"] == 100.0
    for result in results:
        assert 0.0 <= result.contribution_score <= 100.0


def test_overload_score_beyond_one_hundred_is_clamped_not_negative():
    """이상치 점수는 0~100으로 정규화되지만 상류가 바뀌면 100을 넘을 수 있다.
    그때 workload 구성요소가 음수로 내려가면 총점도 음수가 된다."""
    members = [_member("outlier", completion_rate=0.0, overload_score=250.0, anomaly_type="배정량 불균형")]

    results = compute_contribution_scores(members, attendance={}, total_meetings=5)

    assert results[0].workload_component == 0.0
    assert results[0].contribution_score == 0.0


def test_attendance_is_aggregated_within_the_requested_project_only():
    """UT-206. 참석 집계와 전체 회의 수 모두 요청한 project_id로 걸러야 한다.

    한쪽만 프로젝트로 제한하면 참석률이 곧바로 왜곡된다 - 예를 들어 전체 회의 수만 전역으로
    세면 모든 팀원의 참석률이 실제보다 낮게 나온다. 두 쿼리에 각각 project_id가 넘어가는지
    실제 호출 인자로 확인한다.
    """
    execute_result = MagicMock()
    execute_result.mappings.return_value.all.return_value = [{"assignee_id": 1, "attended_count": 2}]
    execute_result.scalar_one.return_value = 4
    conn = MagicMock()
    conn.__enter__.return_value.execute.return_value = execute_result
    engine = MagicMock()
    engine.connect.return_value = conn

    with patch.object(cdb, "get_engine", return_value=engine):
        cdb.load_meeting_attendance(project_id=7)

    passed_params = [call.args[1] for call in conn.__enter__.return_value.execute.call_args_list]
    assert passed_params == [{"project_id": 7}, {"project_id": 7}]
