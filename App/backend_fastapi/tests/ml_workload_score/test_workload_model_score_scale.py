from __future__ import annotations

import pandas as pd

from ml_workload_score.app.services.workload_model import (
    build_features,
    detect_overload_anomalies_robust,
)


def _tasks_df_for(plan: list[tuple[str, int, int]], today: pd.Timestamp) -> pd.DataFrame:
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


def test_non_anomalous_member_does_not_score_100_even_if_team_max():
    """실사용 중 발견된 시나리오 재현: 팀 전원이 이상치 임계값(3.5) 아래라 아무도
    "과부하 의심"/"저활동 의심"이 아닌데도, 그중 상대적으로 가장 튀는 사람이 "팀 내
    최댓값 기준" 스케일링 때문에 무조건 100점을 받던 문제. 이제는 임계값 기준으로
    스케일링하므로, 이상치가 아니면(is_anomaly=False) 100점이 나오면 안 된다."""
    today = pd.Timestamp("2026-07-28")
    # 완만한 차이만 있는 팀 - 아무도 극단적이지 않아 전원 "정상"이어야 한다.
    plan = [
        ("member_a", 20, 10),
        ("member_b", 20, 9),
        ("member_c", 20, 10),
        ("member_d", 20, 13),  # 완료율이 가장 높아 팀 내에서는 "가장 튀는" 사람(그래도 완만한 차이)
        ("member_e", 20, 9),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    assert not result["is_anomaly"].any(), "이 시나리오는 전원 정상이어야 한다"
    max_score = result["overload_score_0_100"].max()
    assert max_score < 100.0, (
        f"아무도 이상치가 아닌데 최고 점수가 100점이면 안 된다 (실제: {max_score})"
    )


def test_anomalous_member_score_still_reaches_100():
    """반대로 실제 이상치(임계값을 넘는 사람)는 여전히 100점 근처(캡)까지 올라가야 한다 —
    스케일링 기준만 바뀌었을 뿐, 진짜 이상치를 놓치면 안 된다."""
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("member_a", 20, 10),
        ("member_b", 20, 10),
        ("member_c", 20, 10),
        ("target", 60, 3),  # 배정량도 훨씬 많고 완료율도 극단적으로 낮음 -> 뚜렷한 과부하
        ("member_e", 20, 10),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    result = detect_overload_anomalies_robust(features)

    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert target_row["is_anomaly"]
    assert target_row["overload_score_0_100"] >= 100.0 - 1e-9
