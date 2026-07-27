from __future__ import annotations

import pandas as pd

from ml_workload_score.app.services.workload_model import (
    build_features,
    detect_overload_anomalies_robust,
)


def _tasks_df_for(plan: list[tuple[str, int, int]], today: pd.Timestamp) -> pd.DataFrame:
    """plan: [(assignee_id, total_tasks, done_tasks), ...]로 tasks_df를 생성한다."""
    rows = []
    task_id = 1
    for name, total, done in plan:
        for i in range(total):
            status = "완료" if i < done else "할 일"
            rows.append({
                "task_id": task_id, "project_id": 1, "assignee_id": name, "category": "백엔드",
                "priority": "중간", "status": status,
                "due_date": today - pd.Timedelta(days=1) if status == "완료" else today + pd.Timedelta(days=5),
            })
            task_id += 1
    return pd.DataFrame(rows)


def test_low_assignment_with_high_completion_is_flagged_as_workload_imbalance_not_low_activity():
    """실사용 중 발견된 시나리오 재현: 배정량 자체가 팀 평균보다 적고 완료율이 높은 팀원은
    "배정량 불균형"(이전 라벨: 저활동 의심)으로 분류돼야 한다. 완료율이 100%인데도
    "저활동 의심"이라는, 태만을 단정하는 듯한 라벨이 붙는 것이 문제였으므로 라벨 자체를
    중립적으로 바꿨다 - 판정(배정량이 적다는 사실)은 맞으므로 여전히 걸려야 정상이다."""
    today = pd.Timestamp("2026-07-23")
    # 화면에서 실제로 재현된 수치: 6명 팀, 한 명(target)만 배정량이 적고 완료율 100%.
    plan = [
        ("member_a", 34, 5),
        ("member_b", 18, 3),
        ("member_c", 38, 9),
        ("member_d", 20, 0),
        ("target", 12, 12),
        ("member_e", 6, 0),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert target_row["completion_rate"] == 1.0
    assert target_row["is_anomaly"]
    # 더 이상 "저활동 의심"(태만을 단정하는 표현)이 아니라 중립적인 "배정량 불균형"이어야 한다.
    assert target_row["anomaly_type"] == "배정량 불균형"
    assert target_row["anomaly_type"] != "저활동 의심"


def test_member_who_completed_all_assigned_tasks_with_average_workload_is_not_flagged():
    """배정량 자체가 팀 평균과 동일한 수준이면, 배정된 업무를 전부 끝내(진행중 업무=0)
    있어도 "배정량 불균형"으로 잡히면 안 된다 - task_count_active_rel(진행중 업무 비율)만
    으로 판단하던 과거 로직은 이 케이스를 항상 오탐지했었다(task_count_total_rel==1.0이면
    "팀 평균보다 적다"는 조건 자체가 성립하지 않으므로 더 이상 걸리지 않는다)."""
    today = pd.Timestamp("2026-07-23")
    plan = [
        ("all_done", 15, 15),
        ("member_a", 15, 5),
        ("member_b", 15, 5),
        ("member_c", 15, 5),
        ("member_d", 15, 5),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    all_done_row = result[result["assignee_id"] == "all_done"].iloc[0]
    # 진행중 업무는 0이므로 task_count_active_rel은 여전히 낮다 (버그 재현 조건 유지)
    assert all_done_row["task_count_active_rel"] < 1.0
    # 배정량(task_count_total)은 팀 평균과 정확히 같은 수준(rel=1.0)이므로 걸리지 않아야 한다.
    assert all_done_row["task_count_total_rel"] == 1.0
    assert all_done_row["anomaly_type"] != "배정량 불균형"
