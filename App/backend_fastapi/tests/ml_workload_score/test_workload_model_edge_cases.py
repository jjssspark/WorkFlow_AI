"""UT-169~171/173: 업무편중 점수의 경계 상황.

기존 테스트(test_workload_model_anomaly_direction.py 등)는 "편중된 팀에서 누가 걸리는가"를
본다. 여기서 보는 것은 그 반대편이다 - 편중이 없을 때 아무도 걸리지 않는가, 그리고 팀 평균이
0이거나 팀원이 1명이라 나눗셈이 성립하지 않는 상황에서 점수가 NaN/무한대로 새지 않는가.

편중 점수는 전부 "팀 평균 대비 상대값"으로 계산된다. 상대값은 팀 평균이 0이면 정의되지 않고,
표본이 1개면 산포(MAD/표준편차)가 0이 되어 z-score가 발산한다. 둘 다 실제로 생길 수 있는
입력이다 - 프로젝트를 막 만들어 아무에게도 업무가 없거나, 1인 프로젝트인 경우다.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from ml_workload_score.app.services.workload_model import (
    ALLOCATION_AXIS_COLUMN,
    DIFFICULTY_AXIS_COLUMNS,
    WORKLOAD_AXIS_COLUMNS,
    build_features,
    detect_overload_anomalies_robust,
)

# 3축 판정이 실제로 읽는 피처 전체. 구 FEATURE_COLUMNS(단일 통합 피처 집합)를 대체한다.
AXIS_FEATURE_COLUMNS = DIFFICULTY_AXIS_COLUMNS + WORKLOAD_AXIS_COLUMNS + [ALLOCATION_AXIS_COLUMN]

# 축별 원시 점수. 통합 overload_score_0_100은 축 점수의 가중합이라, 어느 한 축이 NaN이어도
# 가중합 과정에서 가려질 수 있다. NaN 누출을 보려면 축 점수를 직접 봐야 한다.
AXIS_SCORE_COLUMNS = ["difficulty_score", "workload_score", "allocation_score"]


def _tasks_df(plan: list[tuple[str, int, int]], today: pd.Timestamp) -> pd.DataFrame:
    """plan: [(assignee_id, 전체 업무 수, 완료 업무 수), ...]"""
    rows = []
    task_id = 1
    for name, total, done in plan:
        for i in range(total):
            status = "완료" if i < done else "할 일"
            rows.append({
                "task_id": task_id, "project_id": 1, "assignee_id": name,
                "category": "백엔드", "priority": "중간", "status": status,
                "due_date": today + pd.Timedelta(days=5),
            })
            task_id += 1
    return pd.DataFrame(rows)


def test_evenly_loaded_team_flags_nobody():
    """UT-169. 업무가 균등하면 상대값이 모두 1.0 근처가 되어 아무도 이상치가 아니다.

    이 대조군이 없으면 "항상 누군가를 편중으로 찍는" 구현으로 바뀌어도 편중 탐지 테스트들은
    그대로 통과한다 - 화면에는 매번 근거 없는 경고가 뜨게 된다.
    """
    today = pd.Timestamp("2026-07-23")
    features = build_features(_tasks_df([("a", 3, 1), ("b", 3, 1), ("c", 3, 1)], today), today=today)
    result = detect_overload_anomalies_robust(features)

    assert not result["is_anomaly"].any()
    assert (result["task_count_active_rel"] == 1.0).all()


def _uneven_three_member_team(today: pd.Timestamp) -> pd.DataFrame:
    """A만 업무 10건에 '긴급' 난이도, 나머지 둘은 2건에 '낮음' (UT-170의 사양 데이터)."""
    rows = []
    task_id = 1
    for name, count, priority in [("a", 10, "긴급"), ("b", 2, "낮음"), ("c", 2, "낮음")]:
        for _ in range(count):
            rows.append({
                "task_id": task_id, "project_id": 1, "assignee_id": name,
                "category": "백엔드", "priority": priority, "status": "할 일",
                "due_date": today + pd.Timedelta(days=5),
            })
            task_id += 1
    return pd.DataFrame(rows)


def test_the_most_loaded_member_ranks_highest():
    """UT-170의 앞부분. 업무 수와 난이도가 모두 높은 팀원이 가장 높은 점수를 받는다.

    점수는 "팀 내 최댓값 = 100점" 상대 스케일링이 아니라 이상치 임계값(3.5) 기준 절대
    스케일링이다 - 전원이 정상 범위여도 상대적으로 가장 튀는 사람이 무조건 100점을 받던
    예전 버그가 없다.

    3축 독립 판정에서는 세 축(난이도/업무량/배정량) 각각이 이 데이터(a=10건·긴급 vs
    b/c=2건·낮음, 10:2:2 비율)에 대해 동일한 결합 거리(1.5*sqrt(2) ≈ 2.121, MAD가 0으로
    표준편차 폴백이 걸림)를 내므로 세 축 점수가 모두 같고, 가중평균인
    overload_score_0_100도 같은 값이 된다: 100 * 1.5*sqrt(2) / 3.5.
    """
    today = pd.Timestamp("2026-07-23")
    result = detect_overload_anomalies_robust(
        build_features(_uneven_three_member_team(today), today=today)
    )

    top = result.sort_values("overload_score_0_100", ascending=False).iloc[0]
    assert top["assignee_id"] == "a"
    assert top["overload_score_0_100"] == pytest.approx(100 * 1.5 * math.sqrt(2) / 3.5)


def test_three_member_team_never_reaches_the_warning_threshold():
    """UT-170의 뒷부분("경고 기준을 충족한다")이 성립하지 않는다는 사실을 고정해 둔다.

    팀원이 3명이면 피처마다 값이 두 종류뿐이라 중앙값이 다수값과 겹치고, MAD가 그 차이만큼
    작게 잡혀 modified z-score가 커지지 않는다. 실측: 배정량이 5배인 A의 결합 거리가 3.0으로
    임계값 3.5에 못 미쳐 {@code is_anomaly}가 False다. 점수는 이상치 임계값 기준 약 85.7점
    (팀 내 최고)으로 나오지만 경고로는 잡히지 않는다 - 화면에서는 "가장 높은데 경고는 아님" 상태로 보인다.

    이건 버그 단정이 아니라 관측이다. 이 모듈은 주석대로 5~9명 팀을 겨냥해 임계값을 잡았고,
    같은 로직이 6명 팀에서는 실제로 경고를 낸다(test_workload_model_anomaly_direction.py).
    임계값을 낮추는 판단은 운영 데이터를 보고 사람이 할 일이라 여기서는 손대지 않는다.
    """
    today = pd.Timestamp("2026-07-23")
    result = detect_overload_anomalies_robust(
        build_features(_uneven_three_member_team(today), today=today)
    )

    top = result.sort_values("overload_score_0_100", ascending=False).iloc[0]
    # 3축 전환 + 임계값 기준 스케일링 후에도 같은 관측이 성립한다: a는 세 축 모두 팀 내
    # 최고 결합 거리(1.5*sqrt(2) ≈ 2.121)를 기록하지만, 임계값 3.5에는 못 미쳐 라벨이
    # 하나도 붙지 않는다. "팀 내 최고 점수"와 "이상치 판정"이 서로 독립이라는 게 핵심이다.
    assert top["overload_score_0_100"] == pytest.approx(100 * 1.5 * math.sqrt(2) / 3.5)
    assert not top["is_anomaly"]
    assert top["anomaly_types"] == []


def test_single_member_team_produces_defined_scores_without_dividing_by_zero():
    """UT-173. 팀원이 1명이면 팀 평균이 곧 본인 값이라 상대값은 1.0이고, 산포가 0이라
    비교 대상이 없다. 혼자인 사람을 과부하로 찍는 것은 의미가 없으므로 걸리지 않아야 한다."""
    today = pd.Timestamp("2026-07-23")
    result = detect_overload_anomalies_robust(
        build_features(_tasks_df([("solo", 5, 0)], today), today=today)
    )

    assert len(result) == 1
    # 축 점수까지 봐야 한다. 각 축은 최대값이 0 이하면 0.0으로 덮어쓰는 분기가 있어서,
    # 거리 계산이 NaN이 되어도 0점으로 가려진다(변이로 확인).
    assert np.isfinite(result[AXIS_SCORE_COLUMNS]).all().all()
    assert np.isfinite(result["overload_score_0_100"]).all()
    assert not result["is_anomaly"].any()


def test_scores_stay_finite_when_the_team_average_is_zero():
    """UT-171. 모든 팀원의 완료가 0이고 난이도가 동일하면 여러 피처의 산포가 0이 된다.
    MAD가 0일 때 표준편차로, 그마저 0이면 가중치 0으로 빠지지 않으면 z-score가 무한대가 되어
    점수 전체가 NaN/inf로 새어 화면에 그대로 노출된다."""
    today = pd.Timestamp("2026-07-23")
    features = build_features(_tasks_df([("a", 2, 0), ("b", 2, 0), ("c", 2, 0)], today), today=today)

    assert features[AXIS_FEATURE_COLUMNS].notna().all().all()

    result = detect_overload_anomalies_robust(features)

    assert np.isfinite(result[AXIS_SCORE_COLUMNS]).all().all()
    assert np.isfinite(result["overload_score_0_100"]).all()
    assert not result["overload_score_0_100"].isna().any()
