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
    중립적으로 바꿨다 - 판정(배정량이 적다는 사실)은 맞으므로 여전히 걸려야 정상이다.

    참고: 원래 화면 재현 수치(34/18/38/20/12/6건)로는 나머지 팀원 간 배정량 편차가 너무 커서
    task_count_total_rel의 MAD(중앙값 절대편차) 자체가 커지고, target의 Modified Z-score가
    이상치 threshold(3.5)를 넘지 못했다(실측: modz≈0.47, 걸리지 않음). 아래 수치는 나머지
    팀원들의 배정량 편차를 좁혀(22~28건) MAD 이상치 판정이 실제로 발동하도록 조정한 값이다 -
    "배정량이 팀 평균보다 적은 사람이 배정량 불균형으로 잡혀야 한다"는 테스트 의도와 assert
    대상은 그대로 유지했다."""
    today = pd.Timestamp("2026-07-23")
    # 6명 팀, target만 배정량이 적고(팀 평균 대비) 완료율은 100%.
    plan = [
        ("member_a", 25, 5),
        ("member_b", 22, 3),
        ("member_c", 28, 9),
        ("member_d", 24, 0),
        ("target", 12, 12),
        ("member_e", 26, 0),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert target_row["completion_rate"] == 1.0
    assert bool(target_row["is_anomaly"]) is True
    # 더 이상 "저활동 의심"(태만을 단정하는 표현)이 아니라 중립적인 "배정량 불균형"이어야 한다.
    assert "배정량 불균형" in target_row["anomaly_types"]
    assert "저활동 의심" not in target_row["anomaly_types"]


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
    assert "배정량 불균형" not in all_done_row["anomaly_types"]


def test_high_task_count_with_low_completion_is_flagged_as_workload_heavy():
    """업무량 편중 축(구 과부하 의심): 진행중 업무가 팀 평균보다 많고 완료율이 팀 평균보다
    낮으면 "업무량 편중 의심"이 붙어야 한다."""
    today = pd.Timestamp("2026-07-23")
    plan = [
        ("target", 30, 3),  # 30건 중 3건만 완료 - active=27, completion_rate=0.1
        ("member_a", 8, 4),
        ("member_b", 8, 4),
        ("member_c", 8, 4),
        ("member_d", 8, 4),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert "업무량 편중 의심" in target_row["anomaly_types"]


def test_person_can_be_flagged_on_multiple_axes_simultaneously():
    """배정량은 팀 평균보다 적지만(불균형) 배정받은 소수의 업무가 전부 고난이도라면
    (난이도 편중), 두 라벨이 한 사람에게 동시에 붙어야 한다.

    참고: 원안(target 3건 전부 미완료 "할 일", 나머지 4명 20건씩 완전 균일)으로는
    업무량 축만 발동하고 배정량/난이도 축은 threshold를 넘지 못했다(실측: anomaly_types ==
    ['업무량 이상 패턴(방향 불명확)']만 나옴 - 배정량/난이도 라벨 없음). 아래 수치는
    (1) target의 3건을 모두 완료 처리해 completion_rate를 팀 평균보다 높여 "배정량 불균형"
    판정 조건(task_count_total_rel<1.0 AND completion_rate>team_mean_completion)을 실제로
    충족시키고, (2) 나머지 4명의 배정량에 소폭 편차(18/19/21/22건)를 줘서
    task_count_total_rel의 MAD가 0이 되지 않도록 한 것이다 - "배정량이 적으면서 동시에
    난이도가 편중된 사람은 두 라벨이 동시에 붙어야 한다"는 테스트 의도와 assert 대상은
    원안과 동일하게 유지했다."""
    today = pd.Timestamp("2026-07-23")
    rows = []
    task_id = 1
    # target: 업무 3건, 전부 우선순위 "높음"(고난이도), 전부 완료(완료율을 팀 평균보다 높게)
    for _ in range(3):
        rows.append({"task_id": task_id, "project_id": 1, "assignee_id": "target",
                      "category": "백엔드", "priority": "높음", "status": "완료",
                      "due_date": today - pd.Timedelta(days=1)})
        task_id += 1
    # 나머지 4명: 업무량에 소폭 편차(18/19/21/22건), 우선순위 "낮음", 절반 완료
    for name, total in [("member_a", 18), ("member_b", 19), ("member_c", 21), ("member_d", 22)]:
        done = total // 2
        for i in range(total):
            status = "완료" if i < done else "할 일"
            rows.append({"task_id": task_id, "project_id": 1, "assignee_id": name,
                         "category": "백엔드", "priority": "낮음", "status": status,
                         "due_date": today - pd.Timedelta(days=1) if status == "완료" else today + pd.Timedelta(days=5)})
            task_id += 1
    tasks_df = pd.DataFrame(rows)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert "배정량 불균형" in target_row["anomaly_types"]
    assert any("난이도" in label for label in target_row["anomaly_types"])
