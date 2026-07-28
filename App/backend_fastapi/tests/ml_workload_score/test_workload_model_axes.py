from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml_workload_score.app.services.workload_model import (
    _mad_anomaly,
    _mad_anomaly_multi,
    build_features,
    compute_axis_results,
)


def _tasks_df_for(plan: list[tuple[str, int, int, str]], today: pd.Timestamp) -> pd.DataFrame:
    """plan: [(assignee_id, total_tasks, done_tasks, priority), ...]. category는 항상 백엔드로 고정."""
    rows = []
    task_id = 1
    for name, total, done, priority in plan:
        for i in range(total):
            status = "완료" if i < done else "할 일"
            rows.append({
                "task_id": task_id, "project_id": 1, "assignee_id": name, "category": "백엔드",
                "priority": priority, "status": status,
                "due_date": today - pd.Timedelta(days=1) if status == "완료" else today + pd.Timedelta(days=5),
            })
            task_id += 1
    return pd.DataFrame(rows)


def test_build_features_computes_difficulty_total_rel_not_avg():
    """난이도 총부담(sum)이 개수 효과를 반영해야 한다: 어려운 일 10건 vs 2건은
    건당 평균이 같아도 difficulty_total_rel이 달라야 한다."""
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("many_hard", 10, 0, "높음"),  # 어려운 일 10건
        ("few_hard", 2, 0, "높음"),    # 어려운 일 2건 (건당 평균은 many_hard와 동일)
        ("baseline", 6, 0, "중간"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)

    assert "difficulty_total_rel" in features.columns
    assert "difficulty_avg_rel" not in features.columns  # 구 필드는 제거됨

    many_rel = features.loc[features["assignee_id"] == "many_hard", "difficulty_total_rel"].iloc[0]
    few_rel = features.loc[features["assignee_id"] == "few_hard", "difficulty_total_rel"].iloc[0]
    assert many_rel > few_rel  # 건수가 많을수록 총부담도 커야 함


def test_mad_anomaly_single_feature_flags_extreme_value():
    series = pd.Series([1.0, 1.1, 0.9, 1.0, 50.0])  # 마지막 값이 극단치
    is_anomaly, scores = _mad_anomaly(series)

    assert is_anomaly.tolist() == [False, False, False, False, True]
    assert scores[-1] == pytest.approx(100.0)  # 가장 튀는 값은 점수 100


def test_mad_anomaly_multi_flags_extreme_row():
    X = np.array([[1.0, 0.5], [1.1, 0.4], [0.9, 0.6], [1.0, 0.5], [50.0, 0.5]])
    is_anomaly, scores = _mad_anomaly_multi(X)

    assert is_anomaly.tolist() == [False, False, False, False, True]
    assert scores[-1] == pytest.approx(100.0)


def test_compute_axis_results_person_can_have_multiple_axis_labels():
    """배정량은 적은데(불균형) 그중 어려운 일 비중이 높으면(난이도 편중) 동시에
    두 라벨이 붙어야 한다.

    주의(브리프 원안에서 데이터 조정): 브리프에 적힌 원래 plan은 target을 done=0(완료율 0)으로
    두고 member_a~d를 완전히 동일한 수치(20건/5건 완료)로 둬서, (1) "배정량 불균형" 라벨의
    방향 조건(completion_rate > team_mean_completion)이 완료율 0인 target에서는 절대 성립할 수
    없고, (2) other 4명이 완전히 동일해 MAD=0 → std 폴백이 걸려 target의 modified z-score가
    항상 2.5로 상한(z_threshold=3.5 미만)되어 배정 축 자체가 이상치로 잡히지 않는 문제가 있었다
    (브리프의 `_mad_anomaly`/`compute_axis_results` 구현 그대로 재현해서 확인함). 그래서 이
    테스트만 (a) target이 배정받은 3건을 전부 완료(완료율 100% > 팀 평균)하고, (b) 나머지
    4명의 배정량/완료 수를 약간씩 다르게(18~21건) 둬서 MAD가 0이 아니게 만들었다 - 검증하려는
    행동(배정량 불균형 + 난이도 편중 동시 라벨링)과 assert 문은 브리프 그대로 유지했다."""
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("target", 3, 3, "높음"),    # 배정 3건뿐(팀 평균보다 훨씬 적음), 전부 완료, 전부 높음 우선순위
        ("member_a", 18, 4, "낮음"),
        ("member_b", 19, 4, "낮음"),
        ("member_c", 20, 4, "낮음"),
        ("member_d", 21, 4, "낮음"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    team_mean_completion = features["completion_rate"].mean()

    result = compute_axis_results(features, team_mean_completion)
    target_row = result[result["assignee_id"] == "target"].iloc[0]

    assert "배정량 불균형" in target_row["anomaly_types"]
    assert any("난이도" in label for label in target_row["anomaly_types"])
    assert target_row["is_anomaly"] is True or bool(target_row["is_anomaly"]) is True


def test_compute_axis_results_normal_member_has_empty_labels():
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("normal", 8, 4, "중간"),
        ("member_a", 8, 4, "중간"),
        ("member_b", 8, 4, "중간"),
        ("member_c", 8, 4, "중간"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    team_mean_completion = features["completion_rate"].mean()

    result = compute_axis_results(features, team_mean_completion)
    normal_row = result[result["assignee_id"] == "normal"].iloc[0]

    assert normal_row["anomaly_types"] == []
    assert bool(normal_row["is_anomaly"]) is False


def test_compute_axis_results_overload_score_is_weighted_average():
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("target", 3, 0, "높음"),
        ("member_a", 20, 5, "낮음"),
        ("member_b", 20, 5, "낮음"),
        ("member_c", 20, 5, "낮음"),
        ("member_d", 20, 5, "낮음"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    team_mean_completion = features["completion_rate"].mean()

    result = compute_axis_results(features, team_mean_completion)
    target_row = result[result["assignee_id"] == "target"].iloc[0]

    expected = (
        target_row["difficulty_score"] * 0.6
        + target_row["workload_score"] * 0.2
        + target_row["allocation_score"] * 0.2
    )
    assert target_row["overload_score_0_100"] == pytest.approx(expected)


from ml_workload_score.app.services.workload_model import detect_overload_anomalies_robust


def test_detect_overload_anomalies_robust_uses_three_independent_axes():
    """주의(브리프 원안에서 데이터 조정): 브리프에 적힌 원래 plan은 target을 done=0(완료율 0)으로
    두고 member_a~d를 완전히 동일한 수치(20건/5건 완료)로 둬서, (1) "배정량 불균형" 라벨의
    방향 조건(completion_rate > team_mean_completion)이 완료율 0인 target에서는 절대 성립할 수
    없고, (2) other 4명이 완전히 동일해 MAD=0 → std 폴백이 걸려 target의 modified z-score가
    항상 2.5로 상한(z_threshold=3.5 미만)되어 배정 축 자체가 이상치로 잡히지 않는 문제가 있었다
    (실제로 재현해서 확인함 - modified_z = [0,0,0,0,2.5], threshold=3.5).
    `test_compute_axis_results_person_can_have_multiple_axis_labels`에서 이미 같은 문제를
    발견하고 고친 전례를 그대로 따라, 이 테스트도 (a) target이 배정받은 3건을 전부 완료(완료율
    100% > 팀 평균), (b) 나머지 4명의 배정량/완료 수를 약간씩 다르게(18~21건) 둬서 MAD가 0이
    아니게 만들었다 - 검증하려는 행동(3축 독립 판정 + anomaly_types 리스트 반환)과 assert 문은
    브리프 그대로 유지했다."""
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("target", 3, 3, "높음"),
        ("member_a", 18, 4, "낮음"),
        ("member_b", 19, 4, "낮음"),
        ("member_c", 20, 4, "낮음"),
        ("member_d", 21, 4, "낮음"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)

    result = detect_overload_anomalies_robust(features)
    target_row = result[result["assignee_id"] == "target"].iloc[0]

    assert isinstance(target_row["anomaly_types"], list)
    assert "배정량 불균형" in target_row["anomaly_types"]
    assert "difficulty_score" in result.columns
    assert "workload_score" in result.columns
    assert "allocation_score" in result.columns
    assert "team_mean_completion" in result.attrs


def test_detect_overload_anomalies_robust_normal_member_has_empty_anomaly_types():
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("normal", 8, 4, "중간"),
        ("member_a", 8, 4, "중간"),
        ("member_b", 8, 4, "중간"),
        ("member_c", 8, 4, "중간"),
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)

    result = detect_overload_anomalies_robust(features)
    normal_row = result[result["assignee_id"] == "normal"].iloc[0]

    assert normal_row["anomaly_types"] == []
    assert bool(normal_row["is_anomaly"]) is False


from ml_workload_score.app.services.workload_model import detect_overload_anomalies


def test_detect_overload_anomalies_isolation_forest_path_uses_same_three_axes():
    """팀원 15명 이상(Isolation Forest 경로 트리거 조건)에서도 응답 구조가 MAD 경로와
    동일해야 한다(anomaly_types 리스트 + 축별 점수 3개)."""
    today = pd.Timestamp("2026-07-28")
    plan = [("target", 3, 0, "높음")] + [
        (f"member_{i}", 20, 5, "낮음") for i in range(16)
    ]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)
    assert len(features) >= 15  # Isolation Forest 경로 트리거 조건 확인

    result = detect_overload_anomalies(features)

    assert "anomaly_types" in result.columns
    assert "difficulty_score" in result.columns
    assert "workload_score" in result.columns
    assert "allocation_score" in result.columns
    target_row = result[result["assignee_id"] == "target"].iloc[0]
    assert isinstance(target_row["anomaly_types"], list)
    assert "team_mean_completion" in result.attrs
