# FS-5 업무 편중도 3축 독립 판정 체계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 4피처 통합 MAD 이상치 판정(`anomaly_type` 단일 문자열)을 난이도편중/업무량편중/배정량불균형
3개의 독립 축으로 분리하고, FastAPI → Spring → Frontend(ContributorsView + WorkloadPage) 전 계층에
`anomaly_types: list[str]` + 축별 점수를 전파한다.

**Architecture:** `workload_model.py`에 `difficulty_total_rel`(신규, sum 기반 난이도 총부담) 피처와
`compute_axis_results()`(3축 독립 MAD 판정 함수)를 추가하고, MAD 경로(`detect_overload_anomalies_robust`)와
Isolation Forest 경로(`detect_overload_anomalies`) 둘 다 이 함수를 거치도록 통일한다. 스키마의
`anomaly_type: str` → `anomaly_types: list[str]`로 breaking change하고, 대표 점수는
`difficulty_score*0.6 + workload_score*0.2 + allocation_score*0.2` 가중평균으로 계산한다. 이 변경을
FastAPI 스키마 → Spring DTO(record) → Frontend 타입(camelCase) 순으로 계층별로 전파한다.

**Tech Stack:** Python 3.12 + pandas/numpy(MAD z-score), Pydantic v2, Spring Boot(Java record DTO),
React + TypeScript, pytest, JUnit5/Mockito, Vitest.

## Global Constraints

- 대표 점수 공식은 정확히 `overload_score_0_100 = difficulty_score*0.6 + workload_score*0.2 + allocation_score*0.2`
  (사용자 확정값, 변경 금지).
- 라벨 명명은 "몰림"이 아니라 **"편중"**으로 통일: "난이도 편중 의심", "업무량 편중 의심"(구
  "과부하 의심"), "배정량 불균형"(기존 라벨 그대로 유지 — 예외).
- 방향 불명확 라벨은 축마다 별도: "난이도 이상 패턴(방향 불명확)", "업무량 이상 패턴(방향
  불명확)", "배정 이상 패턴(방향 불명확)".
- `anomaly_type: str` → `anomaly_types: list[str]`는 전 계층(FastAPI/Spring/Frontend) breaking
  change다 — 하위 호환 계층 남기지 않는다(전부 한 번에 갱신).
- `difficulty_avg_rel` → `difficulty_total_rel`로 필드명 자체가 바뀐다(계산 방식도 mean→sum).
- `is_anomaly`(전체) = 세 축 중 하나라도 True.
- MAD 판정 임계값은 기존과 동일하게 `z_threshold=3.5` 유지.
- 기존 `test_low_assignment_with_high_completion_is_flagged_as_workload_imbalance_not_low_activity`,
  `test_member_who_completed_all_assigned_tasks_with_average_workload_is_not_flagged`
  (`test_workload_model_anomaly_direction.py`)의 "배정량 불균형" 판정 조건(`task_count_total_rel<1.0`
  그리고 `completion_rate>team_mean`)은 그대로 유지 — 이번 리팩터링으로 판정 로직 자체가
  바뀌면 안 된다(라벨을 담는 자료구조만 str→list로 바뀜).
- 이 dev 환경은 `redis` 패키지가 venv에 실제로는 설치돼 있지 않아
  (`from redis import Redis` in `core/cache.py`) `app.main`을 import하는 테스트 파일
  (`test_workload_router.py`, `test_contribution_router.py`)이 collection 단계에서 전부
  ImportError로 실패한다 — **이번 작업이 만든 문제가 아닌 사전 존재 환경 이슈**. 이 두 파일을
  수정하는 태스크에서는 `pytest tests/ml_workload_score/test_workload_model_anomaly_direction.py
  tests/ml_workload_score/test_workload_model_team_mean.py tests/ml_workload_score/test_workload_service.py`처럼
  영향받는 다른 파일만 개별 지정해서 돌리고, 라우터 테스트는 코드 리뷰(정적 diff 확인)로 갈음한다.
  `pip install redis==7.4.1`로 이 환경에 실제 설치하는 것은 이번 스코프 밖(무관한 사전 문제 수정).
- 관련 스펙: `document_이은주/superpowers/specs/2026-07-28-workload-difficulty-axes-design.md`

---

### Task 1: `workload_model.py` — `difficulty_total_rel` 피처 + 3축 MAD 핵심 함수

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_model.py:246-268` (`build_features`의 `grouped` 집계 부분), `:274-334` (기존 `FEATURE_COLUMNS`/`detect_overload_anomalies_robust` 자리에 신규 함수 추가)
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py` (신규)

**Interfaces:**
- Produces: `build_features()` 반환 DataFrame에 `difficulty_total`, `difficulty_total_rel` 컬럼 추가(기존 `difficulty_avg`/`difficulty_avg_rel`은 **제거**)
- Produces: `_mad_anomaly(series: pd.Series, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]` — Task 2에서 배정량 불균형 축에 사용
- Produces: `_mad_anomaly_multi(X: np.ndarray, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]` — Task 2에서 난이도/업무량 축에 사용
- Produces: `compute_axis_results(feature_df: pd.DataFrame, team_mean_completion: float) -> pd.DataFrame` — Task 2, 3에서 MAD/IF 양쪽 경로가 공통으로 호출
- Produces: `AXIS_WEIGHTS: dict = {"difficulty": 0.6, "workload": 0.2, "allocation": 0.2}` — Task 2, 4에서 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py`:

```python
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
    두 라벨이 붙어야 한다."""
    today = pd.Timestamp("2026-07-28")
    plan = [
        ("target", 3, 0, "높음"),   # 배정 3건뿐(팀 평균보다 훨씬 적음), 전부 높음 우선순위
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run (from `App/backend_fastapi`): `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v`
Expected: FAIL — `ImportError: cannot import name '_mad_anomaly' from 'ml_workload_score.app.services.workload_model'` (아직 존재하지 않음)

- [ ] **Step 3: `build_features()`의 난이도 집계를 sum 기반으로 변경**

`workload_model.py`의 `grouped = df.groupby("assignee_id").agg(...)` 블록(246-253번 줄)에서
`difficulty_avg=("difficulty", "mean")`을 `difficulty_total=("difficulty", "sum")`으로 바꾸고,
그 아래 상대값 계산 루프(264-266번 줄)의 컬럼 리스트도 맞춘다:

```python
    grouped = df.groupby("assignee_id").agg(
        task_count_total=("task_id", "count"),
        task_count_active=("is_done", lambda s: (~s).sum()),
        task_count_done=("is_done", "sum"),
        difficulty_total=("difficulty", "sum"),
        overdue_count=("is_overdue", "sum"),
        upcoming_due_count=("is_upcoming", "sum"),
    ).reset_index()

    grouped["completion_rate"] = grouped["task_count_done"] / grouped["task_count_total"]
    grouped["overdue_ratio"] = grouped["overdue_count"] / grouped["task_count_total"]

    # 팀 평균 대비 상대값 (정규화) - 과부하는 "팀 평균보다 얼마나 많은가"가 핵심.
    # task_count_total_rel(전체 배정량)은 "배정량 불균형" 판정 전용 근거다: task_count_active
    # (미완료 개수)만으로 판단하면, 배정된 업무를 전부 끝낸 사람도 진행중 업무가 0이 되어
    # "애초에 배정량 자체가 적은 사람"과 "일을 다 끝낸 사람"이 구분되지 않는 문제가 있었다.
    # difficulty_total_rel(총부담)은 "몇 건을 배정받았는지 + 얼마나 어려운지"를 함께 반영한다 -
    # 건당 평균(difficulty_avg_rel, 구 필드)은 업무 개수 효과가 빠져서 난이도 편중 판정에
    # 쓸 수 없었다(어려운 일 3건과 20건이 평균이 같으면 동일 취급되는 문제).
    for col in ["task_count_active", "task_count_total", "difficulty_total"]:
        team_avg = grouped[col].mean()
        grouped[f"{col}_rel"] = grouped[col] / team_avg if team_avg > 0 else 0

    return grouped
```

(`is_done`/`is_overdue`/`is_upcoming`/`difficulty` 계산 부분은 그대로 유지 — 이번 변경은 집계
방식만 바꾼다.)

- [ ] **Step 4: 3축 MAD 핵심 함수 추가**

`workload_model.py`의 기존 `FEATURE_COLUMNS` 정의(274-279번 줄) 바로 아래, `detect_overload_anomalies_robust`
정의(282번 줄) 앞에 다음을 추가한다:

```python
AXIS_WEIGHTS = {"difficulty": 0.6, "workload": 0.2, "allocation": 0.2}


def _mad_anomaly(series: pd.Series, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]:
    """1개 피처 기준 MAD(Median Absolute Deviation) Modified Z-score 이상치 판정.
    반환: (is_anomaly: bool 배열, score_0_100: 0~100 스케일 점수 배열)."""
    x = series.fillna(0).to_numpy(dtype=float)
    median = np.median(x)
    mad = np.median(np.abs(x - median))
    std = x.std()
    denom = mad / 0.6745 if mad > 0 else (std if std > 0 else np.inf)

    modified_z = np.abs(x - median) / denom
    is_anomaly = modified_z > z_threshold

    max_z = modified_z.max()
    score = 100 * modified_z / max_z if max_z > 0 else np.zeros_like(modified_z)
    return is_anomaly, score


def _mad_anomaly_multi(X: np.ndarray, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]:
    """N개 피처 기준 MAD Modified Z-score 유클리드 거리 이상치 판정(기존 통합 로직과 동일한
    방식 - 피처 집합만 축마다 다르게 적용). 반환: (is_anomaly, score_0_100)."""
    median = np.median(X, axis=0)
    mad = np.median(np.abs(X - median), axis=0)
    std = X.std(axis=0)
    denom = np.where(mad > 0, mad / 0.6745, np.where(std > 0, std, np.inf))

    modified_z = (X - median) / denom
    combined_distance = np.sqrt((modified_z ** 2).sum(axis=1))
    is_anomaly = combined_distance > z_threshold

    max_d = combined_distance.max()
    score = 100 * combined_distance / max_d if max_d > 0 else np.zeros_like(combined_distance)
    return is_anomaly, score


def compute_axis_results(feature_df: pd.DataFrame, team_mean_completion: float) -> pd.DataFrame:
    """세 축(난이도 편중/업무량 편중/배정량 불균형)을 각각 독립적으로 MAD 판정하고,
    axis별 is_anomaly/score와 통합 anomaly_types/overload_score_0_100을 채운
    DataFrame을 반환한다. 한 사람이 여러 축에서 동시에 이상치일 수 있다."""
    result = feature_df.reset_index(drop=True).copy()

    diff_anomaly, result["difficulty_score"] = _mad_anomaly_multi(
        result[["difficulty_total_rel", "overdue_ratio"]].fillna(0).to_numpy(dtype=float)
    )
    workload_anomaly, result["workload_score"] = _mad_anomaly_multi(
        result[["task_count_active_rel", "completion_rate"]].fillna(0).to_numpy(dtype=float)
    )
    alloc_anomaly, result["allocation_score"] = _mad_anomaly(result["task_count_total_rel"])

    def _labels(row) -> list[str]:
        labels: list[str] = []
        idx = row.name
        if diff_anomaly[idx]:
            labels.append(
                "난이도 편중 의심" if row["difficulty_total_rel"] > 1.0
                else "난이도 이상 패턴(방향 불명확)"
            )
        if workload_anomaly[idx]:
            if row["task_count_active_rel"] > 1.0 and row["completion_rate"] < team_mean_completion:
                labels.append("업무량 편중 의심")
            else:
                labels.append("업무량 이상 패턴(방향 불명확)")
        if alloc_anomaly[idx]:
            if row["task_count_total_rel"] < 1.0 and row["completion_rate"] > team_mean_completion:
                labels.append("배정량 불균형")
            else:
                labels.append("배정 이상 패턴(방향 불명확)")
        return labels

    result["anomaly_types"] = result.apply(_labels, axis=1)
    result["is_anomaly"] = result["anomaly_types"].apply(lambda t: len(t) > 0)
    result["overload_score_0_100"] = (
        result["difficulty_score"] * AXIS_WEIGHTS["difficulty"]
        + result["workload_score"] * AXIS_WEIGHTS["workload"]
        + result["allocation_score"] * AXIS_WEIGHTS["allocation"]
    )
    return result
```

(`FEATURE_COLUMNS`는 이 Step에서는 아직 지우지 않는다 — Task 4에서 기존 `detect_overload_anomalies_robust`/
`detect_overload_anomalies`가 교체된 뒤 한꺼번에 정리한다. 지금 지우면 아직 안 바뀐 두 함수가
깨진다.)

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v`
Expected: `6 passed`

- [ ] **Step 6: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/services/workload_model.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py
git commit -m "feat: difficulty_total_rel 피처와 3축 독립 MAD 판정 함수(compute_axis_results) 추가"
```

---

### Task 2: `detect_overload_anomalies_robust()`(MAD 경로)를 `compute_axis_results()`로 교체

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_model.py:282-334` (`detect_overload_anomalies_robust` 전체)
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py` (Task 1에서 만든 파일에 추가)

**Interfaces:**
- Consumes: `compute_axis_results(feature_df, team_mean_completion)` (Task 1)
- Produces: `detect_overload_anomalies_robust(feature_df, z_threshold=3.5) -> pd.DataFrame` — 시그니처는 기존과 동일 유지(호출부 `detect_overload_anomalies_auto` 변경 불필요). 반환 DataFrame에 `anomaly_types`(list[str]), `difficulty_score`/`workload_score`/`allocation_score`/`overload_score_0_100`/`is_anomaly` 컬럼 포함. `result.attrs["team_mean_completion"]`는 기존처럼 유지.

- [ ] **Step 1: 실패하는 회귀 테스트 추가**

`test_workload_model_axes.py` 파일 끝에 추가:

```python
from ml_workload_score.app.services.workload_model import detect_overload_anomalies_robust


def test_detect_overload_anomalies_robust_uses_three_independent_axes():
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v -k "robust"`
Expected: FAIL — `assert "배정량 불균형" in target_row["anomaly_types"]`에서 `anomaly_types` 컬럼이 아직 없어 `KeyError`(구 함수가 `anomaly_type` 단일 문자열만 반환하기 때문)

- [ ] **Step 3: `detect_overload_anomalies_robust()` 전체 교체**

`workload_model.py`의 기존 `detect_overload_anomalies_robust` 함수(282-334번 줄) 전체를 다음으로
교체:

```python
def detect_overload_anomalies_robust(feature_df: pd.DataFrame, z_threshold: float = 3.5) -> pd.DataFrame:
    """
    MAD(Median Absolute Deviation) 기반 3축 독립 이상치 탐지(난이도 편중/업무량 편중/배정량
    불균형). Isolation Forest는 표본 수(팀원 수)가 적으면 트리 분할이 불안정해져서 극단값을
    놓치는 경우가 실제로 발생함(5명 팀 검증에서 확인됨). 캡스톤 팀 규모(5~9명)처럼 표본이
    작을 때는 이 방식이 더 안정적.

    z_threshold: Iglewicz & Hoaglin(1993) 권장 기준값 3.5. compute_axis_results()의
    _mad_anomaly[_multi] 기본값과 동일하게 유지하기 위한 파라미터(현재는 세 축 모두 이
    z_threshold를 그대로 쓰지 않고 compute_axis_results 내부 기본값 3.5를 쓴다 - 파라미터화가
    필요해지면 compute_axis_results에 z_threshold를 전달하도록 확장 가능).
    """
    team_mean_completion = feature_df["completion_rate"].mean()
    result = compute_axis_results(feature_df, team_mean_completion)
    result = result.sort_values("overload_score_0_100", ascending=False)
    # anomaly_types 판정에 실제로 쓰인 팀 평균 완료율을 함께 실어 보낸다 - 프론트가
    # 팀 평균보다 높음/낮음 문구를 이 실측값과 함께 보여줄 수 있도록.
    result.attrs["team_mean_completion"] = float(team_mean_completion)
    return result
```

(`z_threshold` 파라미터는 현재 `compute_axis_results`에 전달되지 않아 사실상 미사용 상태가
된다 — 기존 함수 시그니처 호환을 위해 유지하되, 실제로 안 쓰인다는 걸 docstring에 명시했다.
이후 필요해지면 `compute_axis_results(feature_df, team_mean_completion, z_threshold=z_threshold)`로
확장.)

- [ ] **Step 4: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v`
Expected: `8 passed`

- [ ] **Step 5: 기존 anomaly_direction 테스트로 회귀 확인(아직 구 필드 기준이라 실패해야 정상)**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_anomaly_direction.py -v`
Expected: FAIL — `target_row["anomaly_type"]`가 `KeyError`(컬럼명이 `anomaly_types`로 바뀜). 이 파일은
Task 6에서 새 필드명에 맞춰 고친다. 지금은 실패가 예상된 상태임을 확인만 한다.

- [ ] **Step 6: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/services/workload_model.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py
git commit -m "feat: detect_overload_anomalies_robust를 3축 독립 판정(compute_axis_results)으로 전환"
```

---

### Task 3: `detect_overload_anomalies()`(Isolation Forest 경로)도 동일 3축 구조로 전환

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_model.py:381-445` (`detect_overload_anomalies` 전체)
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py` (추가)

**Interfaces:**
- Consumes: `compute_axis_results(feature_df, team_mean_completion)` (Task 1)
- Produces: `detect_overload_anomalies(feature_df, contamination=None) -> pd.DataFrame` — 시그니처 동일 유지. `is_anomaly`/`overload_score_0_100`은 Isolation Forest의 이상치 여부에 3축 라벨을 결합해서 만든다(아래 Step 3 설명).

Isolation Forest 자체는 여전히 팀원 15명 이상에서만 타는 경로이고, 트리 기반 비지도 이상치
탐지의 "이상치 여부"만 이 경로 고유의 방식(전체 4축 피처 결합)으로 판정하되, **라벨/축별 점수는
`compute_axis_results()`의 MAD 기반 3축 결과를 그대로 가져다 쓴다** — 스펙 문서가 요구하는
"어느 경로를 타든 응답 구조(`anomaly_types`, 축별 점수)가 동일" 요건을 가장 단순하게 만족시키는
방법이다(Isolation Forest 결과의 `is_anomaly`만 참고용으로 유지할지, 아예 MAD와 동일하게 3축
독립 판정으로 완전히 대체할지는 아래에서 후자를 택한다 — 스펙에 "같은 3축 구조로 전환"이라고
명시돼 있고, 팀 15명 이상 경로는 실제로 거의 안 타는 경로라 두 가지 이상치 개념을 유지하는
복잡성을 감수할 이유가 없다).

- [ ] **Step 1: 실패하는 테스트 추가**

`test_workload_model_axes.py`에 추가:

```python
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v -k "isolation_forest"`
Expected: FAIL — `anomaly_types` 컬럼 없음(`KeyError`), 구 함수가 `anomaly_type` 단일 문자열만 반환

- [ ] **Step 3: `detect_overload_anomalies()` 전체 교체**

`workload_model.py`의 기존 `detect_overload_anomalies` 함수(381-445번 줄) 전체를 다음으로 교체:

```python
def detect_overload_anomalies(feature_df: pd.DataFrame, contamination: float = None) -> pd.DataFrame:
    """
    팀 규모가 큰 경우(15명 이상)에도 MAD 경로(detect_overload_anomalies_robust)와 동일한
    3축 독립 판정 구조(anomaly_types, difficulty_score/workload_score/allocation_score)를
    유지한다. Isolation Forest(비지도 이상치 모델)는 참고용 전체 이상치 스코어만 계산하고
    (extra_isolation_forest_score 컬럼), 실제 응답에 쓰이는 anomaly_types/overload_score_0_100은
    compute_axis_results()의 MAD 기반 3축 결과를 그대로 사용한다 - 두 개의 서로 다른 이상치
    개념(트리 기반 vs MAD 기반)이 동시에 노출되면 프론트/심사자가 혼란스러우므로, 응답
    구조를 하나로 통일하는 쪽을 택했다.

    contamination: 참고용 Isolation Forest 스코어 계산에만 쓰인다(응답 구조에는 영향 없음).
    """
    n = len(feature_df)
    if contamination is None:
        if n < 3:
            contamination = 0.49
        else:
            contamination = min(0.4, max(1.0 / n, 0.1))

    X = feature_df[FEATURE_COLUMNS].fillna(0).values
    X_scaled = StandardScaler().fit_transform(X)

    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=RANDOM_SEED,
    )
    model.fit(X_scaled)
    raw_score = model.decision_function(X_scaled)

    team_mean_completion = feature_df["completion_rate"].mean()
    result = compute_axis_results(feature_df, team_mean_completion)
    # 참고용: Isolation Forest의 원시 이상치 스코어(0~100, 클수록 이상치에 가까움).
    # anomaly_types/overload_score_0_100 판정에는 쓰이지 않고 디버깅/관찰용으로만 남긴다.
    inverted = -raw_score
    min_v, max_v = inverted.min(), inverted.max()
    result["isolation_forest_reference_score"] = (
        100 * (inverted - min_v) / (max_v - min_v) if max_v > min_v else 50.0
    )

    result = result.sort_values("overload_score_0_100", ascending=False)
    result.attrs["team_mean_completion"] = float(team_mean_completion)
    return result
```

(`FEATURE_COLUMNS` 상수는 이 함수가 여전히 참고용 Isolation Forest 스코어 계산에 쓰므로 Task 4
전까지는 지우지 않는다 — Task 4에서 이 참조 자체를 축 전용 컬럼 리스트 조합으로 바꾸고
`FEATURE_COLUMNS`를 삭제한다.)

- [ ] **Step 4: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v`
Expected: `9 passed`

- [ ] **Step 5: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/services/workload_model.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py
git commit -m "feat: Isolation Forest 경로도 3축 독립 판정 구조(compute_axis_results)로 통일"
```

---

### Task 4: `FEATURE_COLUMNS` 제거 + 축 전용 상수 추가 + `rule_based_score`/`optional_regression_baseline` 재작성

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_model.py:274-279` (기존 `FEATURE_COLUMNS`), `:395` (`detect_overload_anomalies`의 `FEATURE_COLUMNS` 참조), `:451-484` (`rule_based_score`/`optional_regression_baseline`)
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py` (추가)

**Interfaces:**
- Produces: `DIFFICULTY_AXIS_COLUMNS = ["difficulty_total_rel", "overdue_ratio"]`, `WORKLOAD_AXIS_COLUMNS = ["task_count_active_rel", "completion_rate"]`, `ALLOCATION_AXIS_COLUMN = "task_count_total_rel"` — 다른 태스크에서 참조하지 않음(문서/일관성 목적, `detect_overload_anomalies`의 Isolation Forest 참고 스코어 계산에 사용)
- Produces: `rule_based_score(feature_df, w_difficulty=0.6, w_workload=0.2, w_allocation=0.2) -> pd.Series` — 시그니처 변경(기존 `w1..w4` → 3축 이름), 호출부 없음(데드코드, 문서 가치용)

- [ ] **Step 1: 실패하는 테스트 추가**

`test_workload_model_axes.py`에 추가:

```python
from ml_workload_score.app.services.workload_model import (
    ALLOCATION_AXIS_COLUMN,
    DIFFICULTY_AXIS_COLUMNS,
    WORKLOAD_AXIS_COLUMNS,
    rule_based_score,
)


def test_axis_column_constants_defined():
    assert DIFFICULTY_AXIS_COLUMNS == ["difficulty_total_rel", "overdue_ratio"]
    assert WORKLOAD_AXIS_COLUMNS == ["task_count_active_rel", "completion_rate"]
    assert ALLOCATION_AXIS_COLUMN == "task_count_total_rel"


def test_rule_based_score_uses_three_axis_weights():
    today = pd.Timestamp("2026-07-28")
    plan = [("a", 6, 3, "중간"), ("b", 6, 3, "중간")]
    tasks_df = _tasks_df_for(plan, today)
    features = build_features(tasks_df, today=today)

    scores = rule_based_score(features)

    row = features[features["assignee_id"] == "a"].iloc[0]
    expected = (
        0.6 * row["difficulty_total_rel"]
        + 0.2 * row["task_count_active_rel"] * (1 - row["completion_rate"])
        + 0.2 * (1 - min(row["task_count_total_rel"], 1.0))
    )
    assert scores[features["assignee_id"] == "a"].iloc[0] == pytest.approx(expected)
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v -k "axis_column or rule_based"`
Expected: FAIL — `ImportError: cannot import name 'DIFFICULTY_AXIS_COLUMNS'`

- [ ] **Step 3: `FEATURE_COLUMNS` 삭제하고 축 상수로 교체**

`workload_model.py`의 기존 `FEATURE_COLUMNS = [...]` 정의(274-279번 줄)를 다음으로 교체(위치는
`AXIS_WEIGHTS` 정의 바로 앞, Task 1에서 이미 그 아래에 `AXIS_WEIGHTS`를 추가했으므로 이 블록만
교체):

```python
DIFFICULTY_AXIS_COLUMNS = ["difficulty_total_rel", "overdue_ratio"]
WORKLOAD_AXIS_COLUMNS = ["task_count_active_rel", "completion_rate"]
ALLOCATION_AXIS_COLUMN = "task_count_total_rel"

AXIS_WEIGHTS = {"difficulty": 0.6, "workload": 0.2, "allocation": 0.2}
```

(Task 1에서 이미 `AXIS_WEIGHTS`를 추가했다면 중복 정의가 되므로, 이 Step에서는 Task 1이 추가한
`AXIS_WEIGHTS` 줄 앞에 위 세 상수만 삽입하고 기존 `FEATURE_COLUMNS = [...]` 4줄 블록을 삭제하는
형태로 적용한다.)

`detect_overload_anomalies()`(Task 3에서 교체된 함수)의 `X = feature_df[FEATURE_COLUMNS].fillna(0).values`
줄을 다음으로 변경:

```python
    all_axis_columns = DIFFICULTY_AXIS_COLUMNS + WORKLOAD_AXIS_COLUMNS + [ALLOCATION_AXIS_COLUMN]
    X = feature_df[all_axis_columns].fillna(0).values
```

- [ ] **Step 4: `rule_based_score`/`optional_regression_baseline` 재작성**

`workload_model.py` 하단의 `rule_based_score`/`optional_regression_baseline`(451-484번 줄) 전체를
다음으로 교체:

```python
def rule_based_score(feature_df: pd.DataFrame,
                      w_difficulty: float = 0.6, w_workload: float = 0.2,
                      w_allocation: float = 0.2) -> pd.Series:
    """
    3축 가중치(AXIS_WEIGHTS)와 동일한 룰베이스 공식(기존 4피처 통합 공식을 3축 체계로
    재작성):
    overload = w_difficulty*(difficulty_total_rel) + w_workload*(active_rel*(1-completion_rate))
               + w_allocation*(1 - min(total_rel, 1.0))
    이 값을 회귀 모델의 pseudo-label(정답 대용)으로 사용할 수 있음.
    """
    return (
        w_difficulty * feature_df["difficulty_total_rel"]
        + w_workload * feature_df["task_count_active_rel"] * (1 - feature_df["completion_rate"])
        + w_allocation * (1 - feature_df["task_count_total_rel"].clip(upper=1.0))
    )


def optional_regression_baseline(feature_df: pd.DataFrame):
    """
    옵션: 룰베이스 점수를 pseudo-label 삼아 선형회귀 baseline 학습.
    실제 라벨이 아니므로 '룰을 재현하는 모델'이라는 한계를 명시하고 사용할 것.
    """
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import r2_score

    y_pseudo = rule_based_score(feature_df)
    axis_columns = DIFFICULTY_AXIS_COLUMNS + WORKLOAD_AXIS_COLUMNS + [ALLOCATION_AXIS_COLUMN]
    X = feature_df[axis_columns].fillna(0).values

    reg = LinearRegression()
    reg.fit(X, y_pseudo)
    pred = reg.predict(X)

    print("\n[옵션] Self-labeling 회귀 baseline")
    print(f"  R^2 (룰 재현도): {r2_score(y_pseudo, pred):.4f}")
    print(f"  계수: {dict(zip(axis_columns, reg.coef_.round(3)))}")
    return reg
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py -v`
Expected: `11 passed`

- [ ] **Step 6: 파일 전체 임포트 확인(FEATURE_COLUMNS 잔여 참조 없는지)**

Run: `grep -n "FEATURE_COLUMNS" App/backend_fastapi/ml_workload_score/app/services/workload_model.py`
Expected: 결과 없음(전부 `DIFFICULTY_AXIS_COLUMNS`/`WORKLOAD_AXIS_COLUMNS`/`ALLOCATION_AXIS_COLUMN`로 교체됨)

- [ ] **Step 7: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/services/workload_model.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_model_axes.py
git commit -m "refactor: FEATURE_COLUMNS를 3축 전용 상수로 교체, rule_based_score를 3축 공식으로 재작성"
```

---

### Task 5: 기존 `test_workload_model_anomaly_direction.py` / `test_workload_model_team_mean.py`를 새 필드 기준으로 갱신

**Files:**
- Modify: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_anomaly_direction.py` (전체)
- Modify: `App/backend_fastapi/tests/ml_workload_score/test_workload_model_team_mean.py` (변경 없이 그대로 통과하는지만 확인 — 코드 수정 불필요 가능성 높음)

**Interfaces:**
- Consumes: `detect_overload_anomalies_robust`, `build_features` (Task 1~4에서 이미 변경 완료)

이 태스크는 새 기능을 추가하지 않고, Task 2에서 일부러 깨뜨린 채 남겨둔 기존 테스트를
새 자료구조(`anomaly_types: list[str]`)에 맞게 고치는 것이다. TDD의 "실패하는 테스트 먼저"
사이클은 이미 Task 2 Step 5에서 확인했으므로, 여기서는 실패 이유(구 필드명)를 정확히 알고
고치는 리팩터링이다.

- [ ] **Step 1: 현재 실패 상태 재확인**

Run (from `App/backend_fastapi`): `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_anomaly_direction.py -v`
Expected: FAIL — `target_row["anomaly_type"]`에서 `KeyError: 'anomaly_type'`

- [ ] **Step 2: `test_workload_model_anomaly_direction.py`를 새 필드 기준으로 전체 교체**

파일 전체를 다음으로 교체(기존 두 테스트 함수의 검증 대상만 `anomaly_type`(str) →
`anomaly_types`(list, `in` 체크)로 바꾸고, 새 3축 조합 시나리오 테스트 2개를 추가):

```python
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
    (난이도 편중), 두 라벨이 한 사람에게 동시에 붙어야 한다."""
    today = pd.Timestamp("2026-07-23")
    rows = []
    task_id = 1
    # target: 업무 3건, 전부 우선순위 "높음"(고난이도), 전부 미완료
    for _ in range(3):
        rows.append({"task_id": task_id, "project_id": 1, "assignee_id": "target",
                      "category": "백엔드", "priority": "높음", "status": "할 일",
                      "due_date": today + pd.Timedelta(days=5)})
        task_id += 1
    # 나머지 4명: 업무 20건씩, 우선순위 "낮음", 절반 완료
    for name in ["member_a", "member_b", "member_c", "member_d"]:
        for i in range(20):
            status = "완료" if i < 10 else "할 일"
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
```

- [ ] **Step 3: 테스트 실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_anomaly_direction.py -v`
Expected: `4 passed`

- [ ] **Step 4: `test_workload_model_team_mean.py`는 수정 없이 통과하는지 확인**

이 파일은 `team_mean_completion` attrs 전달만 검증하고 `anomaly_type`/`difficulty_avg_rel`을
직접 참조하지 않으므로 코드 변경이 필요 없을 가능성이 높다.

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_team_mean.py -v`
Expected: `2 passed` (수정 없이 통과하면 그대로 두고 다음 단계로; 만약 실패한다면 실패 메시지를
읽고 `attrs["team_mean_completion"]` 전달 경로가 Task 1~4에서 실수로 깨졌는지 확인 후 최소
수정)

- [ ] **Step 5: 이 모듈 전체 회귀 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_model_axes.py tests/ml_workload_score/test_workload_model_anomaly_direction.py tests/ml_workload_score/test_workload_model_team_mean.py tests/ml_workload_score/test_workload_model_embedding.py tests/ml_workload_score/test_workload_model_tracing.py -v`
Expected: 전부 통과, 실패 0건

- [ ] **Step 6: 커밋**

```bash
git add App/backend_fastapi/tests/ml_workload_score/test_workload_model_anomaly_direction.py
git commit -m "test: anomaly_direction 테스트를 anomaly_types 리스트 기준으로 갱신, 3축 조합 케이스 추가"
```

---

### Task 6: `workload_schema.py` / `workload_service.py` — 응답 스키마와 서비스 매핑 갱신

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/schema/workload_schema.py:9-24` (`WorkloadMemberResult`)
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_service.py:79-93` (`get_workload_score`의 `WorkloadMemberResult(...)` 생성부)
- Modify: `App/backend_fastapi/tests/ml_workload_score/test_workload_service.py` (전체 — mock DataFrame 컬럼명 갱신)

**Interfaces:**
- Produces: `WorkloadMemberResult`에 `anomaly_types: list[str]`, `difficulty_score: float`, `workload_score: float`, `allocation_score: float`, `difficulty_total_rel: float` 필드(기존 `anomaly_type`/`difficulty_avg_rel` 대체) — Task 7(contribution_service)에서 이 필드들을 그대로 복사해 씀
- Consumes: Task 2에서 `detect_overload_anomalies_robust`/`detect_overload_anomalies`가 반환하는 DataFrame 컬럼(`anomaly_types`, `difficulty_score`, `workload_score`, `allocation_score`, `difficulty_total_rel`)

- [ ] **Step 1: 실패하는 테스트로 `test_workload_service.py` 전체 교체**

`App/backend_fastapi/tests/ml_workload_score/test_workload_service.py`의 mock DataFrame들과
검증부를 새 필드 기준으로 바꾼 전체 내용으로 교체:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_service import (
    _summarize_get_workload_score_outputs,
    get_workload_score,
)
from ml_workload_score.app.schema.workload_schema import (
    WorkloadMemberResult,
    WorkloadScoreData,
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
async def test_get_workload_score_passes_embedding_adjustments_to_build_features():
    fake_adjustments = {1: 0.42}
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=_fake_tasks_df(),
    ), patch(
        "ml_workload_score.app.services.workload_service.compute_embedding_adjustments",
        AsyncMock(return_value=fake_adjustments),
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

    _, kwargs = mock_build_features.call_args
    assert kwargs["embedding_adjustments"] == fake_adjustments


@pytest.mark.asyncio
async def test_get_workload_score_synthetic_fallback_still_works():
    """DB 조회 실패 시 synthetic fallback 경로는 임베딩 보정 없이도 그대로 동작해야 한다."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        side_effect=RuntimeError("no db"),
    ), patch(
        "ml_workload_score.app.services.workload_service.compute_embedding_adjustments",
        AsyncMock(),
    ) as mock_adjustments:
        result = await get_workload_score(project_id=1, use_synthetic_fallback=True)

    assert result.source == "synthetic_fallback"
    assert len(result.members) > 0
    mock_adjustments.assert_not_called()


def test_get_workload_score_name_preserved_after_traceable():
    from ml_workload_score.app.services.workload_service import get_workload_score
    assert get_workload_score.__name__ == "get_workload_score"


# ============================================================
# process_outputs 요약 reducer 테스트
# (LangSmith 트레이스에 팀원별 개인 데이터 전체 대신 요약 통계만 기록되는지 검증)
# ============================================================
def test_summarize_get_workload_score_outputs_with_anomalies():
    data = WorkloadScoreData(
        project_id=7,
        source="db",
        method="MAD (소규모 팀)",
        members=[
            WorkloadMemberResult(
                assignee_id="1", task_count_total=5, completion_rate=0.4,
                overload_score=92.5, is_anomaly=True, anomaly_types=["업무량 편중 의심"],
                difficulty_score=80.0, workload_score=95.0, allocation_score=10.0,
                task_count_active_rel=1.5, task_count_total_rel=1.5,
                difficulty_total_rel=1.2, overdue_count=1,
            ),
            WorkloadMemberResult(
                assignee_id="2", task_count_total=2, completion_rate=0.9,
                overload_score=10.0, is_anomaly=False, anomaly_types=[],
                difficulty_score=5.0, workload_score=5.0, allocation_score=5.0,
                task_count_active_rel=0.8, task_count_total_rel=0.8,
                difficulty_total_rel=0.9, overdue_count=0,
            ),
        ],
        note=None,
    )
    result = _summarize_get_workload_score_outputs(data)
    assert result == {
        "project_id": 7,
        "source": "db",
        "method": "MAD (소규모 팀)",
        "member_count": 2,
        "anomaly_count": 1,
        "note": None,
    }


def test_summarize_get_workload_score_outputs_empty_members():
    data = WorkloadScoreData(
        project_id=3,
        source="db",
        method="N/A",
        members=[],
        note="배정된 업무가 없어 편중 점수를 계산할 수 없습니다.",
    )
    result = _summarize_get_workload_score_outputs(data)
    assert result == {
        "project_id": 3,
        "source": "db",
        "method": "N/A",
        "member_count": 0,
        "anomaly_count": 0,
        "note": "배정된 업무가 없어 편중 점수를 계산할 수 없습니다.",
    }


@pytest.mark.asyncio
async def test_get_workload_score_includes_workload_evidence_fields():
    """편중도 근거 패널이 필요로 하는 필드들이 응답까지 그대로 전달되는지 확인한다."""
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=_fake_tasks_df(),
    ), patch(
        "ml_workload_score.app.services.workload_service.compute_embedding_adjustments",
        AsyncMock(return_value={}),
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
        "ml_workload_score.app.services.workload_service.compute_embedding_adjustments",
        AsyncMock(return_value={}),
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
        "ml_workload_score.app.services.workload_service.compute_embedding_adjustments",
        AsyncMock(return_value={}),
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_service.py -v`
Expected: FAIL — `WorkloadMemberResult(...)`에 `anomaly_types`/`difficulty_score`/`workload_score`/
`allocation_score`/`difficulty_total_rel` 키워드를 넘겼는데 스키마가 아직 `anomaly_type`/
`difficulty_avg_rel`만 알고 있어 `pydantic.ValidationError: extra fields not permitted` 또는
필수 필드 누락 에러

- [ ] **Step 3: `workload_schema.py`의 `WorkloadMemberResult` 갱신**

`App/backend_fastapi/ml_workload_score/app/schema/workload_schema.py`의 `WorkloadMemberResult`
클래스(9-24번 줄) 전체를 다음으로 교체:

```python
class WorkloadMemberResult(BaseModel):
    assignee_id: str
    task_count_total: int
    completion_rate: float
    # 대표 점수: difficulty_score*0.6 + workload_score*0.2 + allocation_score*0.2 가중평균.
    # 필드명은 하위 호환을 위해 overload_score로 유지.
    overload_score: float
    is_anomaly: bool                # 세 축(난이도 편중/업무량 편중/배정량 불균형) 중 하나라도 True
    # 이상치로 판정된 축들의 라벨 목록. 정상이면 빈 리스트. 한 사람이 여러 축에서 동시에
    # 이상치일 수 있으므로(예: 배정량은 적은데 난이도는 몰림) 단일 문자열이 아니라 리스트다.
    anomaly_types: list[str]
    # --- 축별 점수(0~100) - 편중도 근거 패널이 축별로 세분화된 근거를 보여줄 때 사용 ---
    difficulty_score: float         # 난이도 편중 축
    workload_score: float           # 업무량 편중 축
    allocation_score: float         # 배정량 불균형 축
    # --- 편중도 근거 패널용 신규 필드 (build_features()가 이미 계산하던 값) ---
    task_count_active_rel: float
    # "배정량 불균형" 판정 및 근거 문구 전용: 애초에 배정받은 전체 업무 수의 팀 평균 대비 비율.
    # task_count_active_rel(진행중 업무 비율)로 이를 판단하면 배정된 업무를 전부
    # 끝낸 사람도 진행중 업무가 0이 되어 무조건 걸리는 문제가 있으므로 이 필드를 대신 쓴다.
    task_count_total_rel: float
    # "난이도 편중" 판정 및 근거 문구 전용: assignee별 난이도 합산(sum)의 팀 평균 대비 비율.
    # 건당 평균(구 difficulty_avg_rel)은 업무 개수 효과가 빠져서, 어려운 일 3건과 20건이
    # 평균이 같으면 동일 취급되는 문제가 있었다.
    difficulty_total_rel: float
    overdue_count: int
```

- [ ] **Step 4: `workload_service.py`의 `WorkloadMemberResult(...)` 생성부 갱신**

`App/backend_fastapi/ml_workload_score/app/services/workload_service.py`의 `members = [...]`
블록(79-93번 줄)을 다음으로 교체:

```python
    members = [
        WorkloadMemberResult(
            assignee_id=row["assignee_id"],
            task_count_total=int(row["task_count_total"]),
            completion_rate=round(float(row["completion_rate"]), 3),
            overload_score=round(float(row["overload_score_0_100"]), 1),
            is_anomaly=bool(row["is_anomaly"]),
            anomaly_types=list(row["anomaly_types"]),
            difficulty_score=round(float(row["difficulty_score"]), 1),
            workload_score=round(float(row["workload_score"]), 1),
            allocation_score=round(float(row["allocation_score"]), 1),
            task_count_active_rel=round(float(row["task_count_active_rel"]), 3),
            task_count_total_rel=round(float(row["task_count_total_rel"]), 3),
            difficulty_total_rel=round(float(row["difficulty_total_rel"]), 3),
            overdue_count=int(row["overdue_count"]),
        )
        for _, row in result.iterrows()
    ]
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_service.py -v`
Expected: `8 passed`

- [ ] **Step 6: 이 모듈 전체(라우터 제외) 회귀 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score --ignore=tests/ml_workload_score/test_workload_router.py -v`
Expected: 전부 통과, 실패 0건 (라우터 테스트는 Global Constraints에 적은 사전 존재 redis
ImportError 때문에 이 환경에서 collection 자체가 안 됨 — Task 9에서 정적 리뷰로 갈음)

- [ ] **Step 7: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/schema/workload_schema.py \
        App/backend_fastapi/ml_workload_score/app/services/workload_service.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_service.py
git commit -m "feat: WorkloadMemberResult를 anomaly_types 리스트 + 축별 점수 구조로 갱신"
```

---

### Task 7: `contribution_schema.py` / `contribution_service.py` — 기여도 점수 쪽 필드 전파

**Files:**
- Modify: `App/backend_fastapi/contribution_score/app/schema/contribution_schema.py:8-19` (`ContributionMemberResult`)
- Modify: `App/backend_fastapi/contribution_score/app/services/contribution_service.py` (전체, `workload_component_of()`와 `compute_contribution_scores()`)
- Modify: `App/backend_fastapi/tests/contribution_score/test_contribution_service.py` (전체)

**Interfaces:**
- Consumes: `WorkloadMemberResult`(Task 6에서 갱신된 필드: `anomaly_types`, `difficulty_score`, `workload_score`, `allocation_score`, `difficulty_total_rel`)
- Produces: `ContributionMemberResult`에 동일 패턴 필드 추가 — Task 8(Spring DTO)에서 이 JSON 응답을 그대로 매핑
- Produces: `workload_component_of(member: WorkloadMemberResult) -> float` — 판정 조건이 `member.anomaly_type == "배정량 불균형"`에서 `"배정량 불균형" in member.anomaly_types`로 변경(시그니처는 동일)

- [ ] **Step 1: 실패하는 테스트로 `test_contribution_service.py` 전체 교체**

`App/backend_fastapi/tests/contribution_score/test_contribution_service.py` 전체를 다음으로
교체:

```python
from __future__ import annotations

import pytest

from contribution_score.app.services.contribution_service import (
    compute_contribution_scores,
    meeting_component_of,
    workload_component_of,
)
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult


def _member(
    assignee_id="1", completion_rate=0.5, overload_score=0.0,
    anomaly_types: list[str] | None = None,
) -> WorkloadMemberResult:
    types = anomaly_types if anomaly_types is not None else []
    return WorkloadMemberResult(
        assignee_id=assignee_id,
        task_count_total=10,
        completion_rate=completion_rate,
        overload_score=overload_score,
        is_anomaly=len(types) > 0,
        anomaly_types=types,
        difficulty_score=10.0,
        workload_score=10.0,
        allocation_score=10.0,
        task_count_active_rel=1.2,
        task_count_total_rel=1.2,
        difficulty_total_rel=1.1,
        overdue_count=1,
    )


def test_workload_component_penalizes_workload_imbalance():
    member = _member(overload_score=82.5, anomaly_types=["배정량 불균형"])
    assert workload_component_of(member) == pytest.approx(17.5)


def test_workload_component_penalizes_when_workload_imbalance_combined_with_other_axis():
    """배정량 불균형이 다른 축(난이도 편중)과 함께 있어도 동일하게 감점돼야 한다."""
    member = _member(overload_score=82.5, anomaly_types=["난이도 편중 의심", "배정량 불균형"])
    assert workload_component_of(member) == pytest.approx(17.5)


def test_workload_component_does_not_penalize_workload_heavy_alone():
    member = _member(overload_score=82.5, anomaly_types=["업무량 편중 의심"])
    assert workload_component_of(member) == 100.0


def test_workload_component_normal_is_full_score():
    member = _member(overload_score=5.0, anomaly_types=[])
    assert workload_component_of(member) == 100.0


def test_workload_component_clamps_at_zero_for_extreme_outlier():
    member = _member(overload_score=150.0, anomaly_types=["배정량 불균형"])
    assert workload_component_of(member) == 0.0


def test_meeting_component_no_meetings_held_is_full_score():
    assert meeting_component_of(attended=0, total=0) == 100.0


def test_meeting_component_partial_attendance():
    assert meeting_component_of(attended=3, total=4) == 75.0


def test_meeting_component_full_attendance():
    assert meeting_component_of(attended=5, total=5) == 100.0


def test_compute_contribution_scores_missing_attendance_defaults_to_zero():
    from contribution_score.app.services import contribution_service as svc

    members = [_member(assignee_id="9", completion_rate=0.8, overload_score=0.0, anomaly_types=[])]
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
    assert result.anomaly_types == []
    assert result.task_count_active_rel == pytest.approx(1.2)
    assert result.task_count_total_rel == pytest.approx(1.2)
    assert result.difficulty_total_rel == pytest.approx(1.1)
    assert result.overdue_count == 1


def test_compute_contribution_scores_uses_experiment_derived_weights():
    from contribution_score.app.services import contribution_service as svc

    total = svc.WEIGHT_WORKLOAD + svc.WEIGHT_TASK + svc.WEIGHT_MEETING
    assert total == pytest.approx(1.0)
    assert svc.WEIGHT_WORKLOAD == pytest.approx(0.2016)
    assert svc.WEIGHT_TASK == pytest.approx(0.4911)
    assert svc.WEIGHT_MEETING == pytest.approx(0.3073)
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run (from `App/backend_fastapi`): `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/contribution_score/test_contribution_service.py -v`
Expected: FAIL — `_member()`가 `WorkloadMemberResult(...)`를 `anomaly_types=...` 키워드로 생성하려는데
스키마가 아직 Task 6 이전 상태라면 이미 Task 6에서 통과했을 것이므로, 여기서는
`workload_component_of()`/`compute_contribution_scores()`가 아직 `member.anomaly_type`(구
필드)를 참조해서 `AttributeError: 'WorkloadMemberResult' object has no attribute 'anomaly_type'`

- [ ] **Step 3: `contribution_schema.py`의 `ContributionMemberResult` 갱신**

`App/backend_fastapi/contribution_score/app/schema/contribution_schema.py`의
`ContributionMemberResult` 클래스(8-19번 줄) 전체를 다음으로 교체:

```python
class ContributionMemberResult(BaseModel):
    assignee_id: str
    workload_component: float
    task_component: float
    meeting_component: float
    contribution_score: float
    # --- 편중도 근거 패널용 신규 필드 (WorkloadMemberResult에서 그대로 복사) ---
    anomaly_types: list[str]
    difficulty_score: float
    workload_score: float
    allocation_score: float
    task_count_active_rel: float
    task_count_total_rel: float
    difficulty_total_rel: float
    overdue_count: int
```

- [ ] **Step 4: `contribution_service.py` 갱신**

`App/backend_fastapi/contribution_score/app/services/contribution_service.py` 전체를 다음으로
교체:

```python
from __future__ import annotations

from contribution_score.app.schema.contribution_schema import ContributionMemberResult
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult

# 2026-07-20 PCA/엔트로피 가중치 실험 결과 반영 (document_이은주/2026-07-20-contribution-weight-experiment.md)
WEIGHT_WORKLOAD = 0.2016
WEIGHT_TASK = 0.4911
WEIGHT_MEETING = 0.3073


def workload_component_of(member: WorkloadMemberResult) -> float:
    """
    overload_score는 세 축(난이도 편중/업무량 편중/배정량 불균형) 중 하나라도 이상치면
    커진다(방향을 구분하지 않음). 기여도 관점에서는 "배정량 불균형"(애초에 배정받은 업무
    자체가 팀 평균보다 적음)만 감점 대상이어야 하므로, anomaly_types에 이 라벨이 포함된
    경우에만 100에서 빼서 반영하고 그 외(정상/업무량 편중/난이도 편중/불명확)는 만점
    처리한다. 다른 축과 함께 걸려 있어도(예: 배정량 불균형 + 난이도 편중 동시) 배정량
    불균형이 포함돼 있으면 동일하게 감점한다.
    """
    if "배정량 불균형" in member.anomaly_types:
        return max(0.0, 100.0 - member.overload_score)
    return 100.0


def meeting_component_of(attended: int, total: int) -> float:
    """전체 회의가 0건이면 참석 못 할 회의가 없었던 것이므로 불이익 없이 만점 처리."""
    if total <= 0:
        return 100.0
    return round(attended / total * 100, 1)


def compute_contribution_scores(
    workload_members: list[WorkloadMemberResult],
    attendance: dict[str, int],
    total_meetings: int,
) -> list[ContributionMemberResult]:
    """
    workload_members: get_workload_score()가 반환한 팀원 목록(workload+task 피처의 원천).
    attendance: {assignee_id(str): 참석 횟수} — load_meeting_attendance()의 첫 번째 반환값.
    총 회의 수는 total_meetings로 별도 전달(모든 팀원에게 공통값).
    workload_members에는 있지만 attendance에 없는 팀원은 참석 0회로 처리한다
    (결측이 아니라 "회의에 한 번도 참석하지 않음"이 맞는 해석).
    """
    results: list[ContributionMemberResult] = []
    for member in workload_members:
        workload_comp = workload_component_of(member)
        task_comp = round(member.completion_rate * 100, 1)
        meeting_comp = meeting_component_of(attendance.get(member.assignee_id, 0), total_meetings)
        score = round(
            WEIGHT_WORKLOAD * workload_comp + WEIGHT_TASK * task_comp + WEIGHT_MEETING * meeting_comp,
            1,
        )
        results.append(
            ContributionMemberResult(
                assignee_id=member.assignee_id,
                workload_component=workload_comp,
                task_component=task_comp,
                meeting_component=meeting_comp,
                contribution_score=score,
                anomaly_types=member.anomaly_types,
                difficulty_score=member.difficulty_score,
                workload_score=member.workload_score,
                allocation_score=member.allocation_score,
                task_count_active_rel=member.task_count_active_rel,
                task_count_total_rel=member.task_count_total_rel,
                difficulty_total_rel=member.difficulty_total_rel,
                overdue_count=member.overdue_count,
            )
        )
    return results
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/contribution_score/test_contribution_service.py -v`
Expected: `9 passed`

- [ ] **Step 6: `test_contribution_router.py`의 mock 데이터도 새 필드 기준으로 갱신**

`App/backend_fastapi/tests/contribution_score/test_contribution_router.py`의
`_fake_workload_data()`(14-27번 줄) 내부 `WorkloadMemberResult(...)` 생성부를 다음으로 교체:

```python
def _fake_workload_data() -> WorkloadScoreData:
    return WorkloadScoreData(
        project_id=1,
        source="db",
        method="MAD (소규모 팀)",
        members=[
            WorkloadMemberResult(
                assignee_id="3", task_count_total=10, completion_rate=0.8,
                overload_score=10.0, is_anomaly=False, anomaly_types=[],
                difficulty_score=5.0, workload_score=5.0, allocation_score=5.0,
                task_count_active_rel=1.0, task_count_total_rel=1.0,
                difficulty_total_rel=1.0, overdue_count=0,
            )
        ],
        team_mean_completion=0.65,
    )
```

(이 파일은 `app.main`을 import하므로 Global Constraints에 적은 redis ImportError로 이 환경에서는
collection 자체가 안 된다 — 코드는 수정하되 로컬 실행 검증은 생략하고 Task 9의 정적 리뷰로
갈음한다.)

- [ ] **Step 7: `ai_contribution_report`의 `test_contribution_service.py`는 영향 없는지 확인**

`App/backend_fastapi/ai_contribution_report/`는 `workload_scores` DB 테이블에서 `anomaly_type`을
직접 읽는 별개 레거시 경로이고(스펙 문서의 "스코프 밖" 항목), `contribution_score`(이 태스크에서
수정한 모듈)와는 다른 모듈이다. 아래 명령으로 영향이 없는지만 확인한다:

Run: `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ai_contribution_report/test_contribution_service.py tests/ai_contribution_report/test_contribution_db.py -v`
Expected: 전부 통과(이번 변경과 무관하게 기존 상태 그대로 — `anomaly_type` 단일 문자열을 계속
사용하는 완전히 별개 경로이므로 실패하면 안 됨)

- [ ] **Step 8: 커밋**

```bash
git add App/backend_fastapi/contribution_score/app/schema/contribution_schema.py \
        App/backend_fastapi/contribution_score/app/services/contribution_service.py \
        App/backend_fastapi/tests/contribution_score/test_contribution_service.py \
        App/backend_fastapi/tests/contribution_score/test_contribution_router.py
git commit -m "feat: ContributionMemberResult에 anomaly_types 리스트 + 축별 점수 필드 전파"
```

---

### Task 8: Spring DTO(`WorkloadScoreMemberDto`, `ContributionMemberScoreDto`) 갱신 + 관련 테스트

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/WorkloadScoreMemberDto.java` (전체)
- Modify: `App/backend_spring/src/main/java/com/workflowai/contribution/ContributionMemberScoreDto.java` (전체)
- Modify: `App/backend_spring/src/test/java/com/workflowai/dashboard/service/DashboardServiceTest.java:217-232` (`getWorkloadScoreDelegatesToFastApiWorkloadScoreClient`)
- Modify: `App/backend_spring/src/test/java/com/workflowai/dashboard/controller/DashboardControllerTest.java:114-130` (`getWorkloadScoreReturnsDataFromService`)
- Modify: `App/backend_spring/src/test/java/com/workflowai/contribution/ContributionScoreControllerTest.java` (해당 테스트 메서드)

**Interfaces:**
- Produces: `WorkloadScoreMemberDto(String assignee_id, Integer task_count_total, Double completion_rate, Double overload_score, Boolean is_anomaly, List<String> anomaly_types, Double difficulty_score, Double workload_score, Double allocation_score, Double task_count_active_rel, Double task_count_total_rel, Double difficulty_total_rel, Integer overdue_count)` — Task 10(Frontend workloadScoreApi.ts)에서 이 JSON 구조를 그대로 매핑
- Produces: `ContributionMemberScoreDto(String assignee_id, Double workload_component, Double task_component, Double meeting_component, Double contribution_score, List<String> anomaly_types, Double difficulty_score, Double workload_score, Double allocation_score, Double task_count_active_rel, Double task_count_total_rel, Double difficulty_total_rel, Integer overdue_count)` — Task 9(Frontend contributorsApi.ts)에서 이 JSON 구조를 그대로 매핑

이 두 DTO는 순수 필드 매핑(Java record)이라 로직이 없다 — 리스트 필드로 바뀐 것을 컴파일이
강제로 잡아주므로, "실패하는 테스트 먼저"보다 "필드를 바꾸고 테스트를 갱신 → 컴파일 및 테스트로
확인"이 이 태스크에 더 적합하다(record는 필드 자체가 계약이라 필드를 안 바꾸면 테스트를 먼저
작성해도 실패시킬 방법이 없다 — 신규 필드를 참조하는 테스트는 기존 DTO에 없는 생성자 인자라
컴파일 자체가 안 되는 방식으로 "실패"한다).

- [ ] **Step 1: DTO 두 개를 새 필드로 교체**

`App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/WorkloadScoreMemberDto.java` 전체:

```java
package com.workflowai.dashboard.DTO;

import java.util.List;

public record WorkloadScoreMemberDto(
    String assignee_id,
    Integer task_count_total,
    Double completion_rate,
    Double overload_score,
    Boolean is_anomaly,
    List<String> anomaly_types,
    Double difficulty_score,
    Double workload_score,
    Double allocation_score,
    Double task_count_active_rel,
    Double task_count_total_rel,
    Double difficulty_total_rel,
    Integer overdue_count
) {}
```

`App/backend_spring/src/main/java/com/workflowai/contribution/ContributionMemberScoreDto.java` 전체:

```java
package com.workflowai.contribution;

import java.util.List;

public record ContributionMemberScoreDto(
    String assignee_id,
    Double workload_component,
    Double task_component,
    Double meeting_component,
    Double contribution_score,
    List<String> anomaly_types,
    Double difficulty_score,
    Double workload_score,
    Double allocation_score,
    Double task_count_active_rel,
    Double task_count_total_rel,
    Double difficulty_total_rel,
    Integer overdue_count
) {}
```

- [ ] **Step 2: 컴파일해서 깨지는 지점 전부 확인**

Run (from `App/backend_spring`): `./gradlew compileTestJava 2>&1 | grep -E "error:|\.java:"`
Expected: `DashboardServiceTest.java`, `DashboardControllerTest.java`,
`ContributionScoreControllerTest.java`에서 구 DTO 생성자 시그니처(9개 인자, `String
anomaly_type`)를 쓰는 지점이 컴파일 에러로 나열됨(정확히 Step 3~5에서 고칠 3개 파일)

- [ ] **Step 3: `DashboardServiceTest.java` 갱신**

`getWorkloadScoreDelegatesToFastApiWorkloadScoreClient`(217-232번 줄)를 다음으로 교체:

```java
    @Test
    void getWorkloadScoreDelegatesToFastApiWorkloadScoreClient() {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        WorkloadScoreResponseDto response = new WorkloadScoreResponseDto(
            "1.0", 1L, "db", "MAD (소규모 팀)",
            List.of(new WorkloadScoreMemberDto(
                "5", 12, 0.4, 88.5, true, List.of("업무량 편중 의심"),
                90.0, 85.0, 10.0, 1.8, 1.2, 1.3, 3
            )),
            null, 0.62
        );
        when(fastApiWorkloadScoreClient.fetch(1L)).thenReturn(response);

        WorkloadScoreResponseDto result = newService().getWorkloadScore("demo-project");

        assertThat(result.members()).hasSize(1);
        assertThat(result.members().get(0).anomaly_types()).containsExactly("업무량 편중 의심");
        assertThat(result.team_mean_completion()).isEqualTo(0.62);
    }
```

- [ ] **Step 4: `DashboardControllerTest.java` 갱신**

`getWorkloadScoreReturnsDataFromService`(114-130번 줄)를 다음으로 교체:

```java
    @Test
    void getWorkloadScoreReturnsDataFromService() throws Exception {
        WorkloadScoreResponseDto response = new WorkloadScoreResponseDto(
            "1.0", 1L, "db", "MAD (소규모 팀)",
            List.of(new WorkloadScoreMemberDto(
                "5", 12, 0.4, 88.5, true, List.of("업무량 편중 의심"),
                90.0, 85.0, 10.0, 1.8, 1.2, 1.3, 3
            )),
            null, 0.62
        );
        when(dashboardService.getWorkloadScore(eq("demo-project"))).thenReturn(response);

        DashboardController controller = new DashboardController(dashboardService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/projects/demo-project/dashboard/workload-score"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.members[0].anomaly_types[0]").value("업무량 편중 의심"))
            .andExpect(jsonPath("$.data.members[0].overload_score").value(88.5));
    }
```

- [ ] **Step 5: `ContributionScoreControllerTest.java` 갱신**

`App/backend_spring/src/test/java/com/workflowai/contribution/ContributionScoreControllerTest.java`의
`import static ...jsonPath` 아래에 이미 `import java.util.List;`가 있음(11번 줄) — 추가 import
불필요.

`getScoreReturnsDataFromFastApi()`의 `ContributionScoreResponseDto` 생성부(30-36번 줄)를 다음으로
교체:

```java
        ContributionScoreResponseDto fastApiResponse = new ContributionScoreResponseDto(
            "1.0",
            1L,
            List.of(new ContributionMemberScoreDto(
                "3", 100.0, 80.0, 80.0, 86.7, List.of(),
                5.0, 5.0, 5.0, 1.0, 1.0, 1.0, 0
            )),
            null,
            0.65
        );
```

그 아래 jsonPath 단언부(48-57번 줄)의 51번 줄과 53번 줄을 다음으로 교체:

```java
            .andExpect(jsonPath("$.data.members[0].assignee_id").value("3"))
            .andExpect(jsonPath("$.data.members[0].contribution_score").value(86.7))
            .andExpect(jsonPath("$.data.members[0].anomaly_types").isEmpty())
            .andExpect(jsonPath("$.data.members[0].task_count_active_rel").value(1.0))
            .andExpect(jsonPath("$.data.members[0].difficulty_total_rel").value(1.0))
            .andExpect(jsonPath("$.data.members[0].overdue_count").value(0))
            // FastAPI가 내려준 team_mean_completion이 그대로 노출돼야 함 —
            // 편중도 근거 패널이 "팀 평균보다 높음/낮음" 문구의 실측 근거로 사용한다.
            .andExpect(jsonPath("$.data.team_mean_completion").value(0.65));
```

(`difficulty_avg_rel` → `difficulty_total_rel`로 jsonPath 경로 자체도 바뀐다는 점에 주의.)

- [ ] **Step 6: 전체 컴파일 + 테스트 실행**

Run: `./gradlew test --tests "*DashboardServiceTest*" --tests "*DashboardControllerTest*" --tests "*ContributionScoreControllerTest*"`
Expected: `BUILD SUCCESSFUL`, 3개 테스트 클래스 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/WorkloadScoreMemberDto.java \
        App/backend_spring/src/main/java/com/workflowai/contribution/ContributionMemberScoreDto.java \
        App/backend_spring/src/test/java/com/workflowai/dashboard/service/DashboardServiceTest.java \
        App/backend_spring/src/test/java/com/workflowai/dashboard/controller/DashboardControllerTest.java \
        App/backend_spring/src/test/java/com/workflowai/contribution/ContributionScoreControllerTest.java
git commit -m "feat: Spring DTO를 anomaly_types 리스트 + 축별 점수 구조로 갱신"
```

---

### Task 9: Frontend `contributorsApi.ts` + `MemberDrilldownPanel.tsx` — 다중 배지 + 축별 근거 문구

**Files:**
- Modify: `App/frontend/src/contributors/libs/utils/contributorsApi.ts:31-63` (`RawContributionMemberScore`, `ContributionMemberScoreDto`, 매핑부)
- Modify: `App/frontend/src/contributors/components/MemberDrilldownPanel.tsx:18-67, 225-289` (`WorkloadEvidenceInput`, `buildWorkloadEvidenceSentences`, `ANOMALY_BADGE_STYLE`, `WorkloadEvidenceDetails`)
- Modify: `App/frontend/src/contributors/libs/utils/contributorsApi.test.ts` (전체)
- Modify: `App/frontend/src/contributors/components/MemberDrilldownPanel.test.tsx:239-410` (workload mode 관련 부분)
- Modify: `App/frontend/src/contributors/screen/ContributorsView.test.tsx` (mock 데이터의 `anomalyType` 필드만 갱신 — 로직 영향 없음)

**Interfaces:**
- Produces: `ContributionMemberScoreDto`에 `anomalyTypes: string[]`, `difficultyScore`/`workloadScore`/`allocationScore`, `difficultyTotalRel`(구 `difficultyAvgRel` 대체) — Task 10과 무관(별개 Raw 타입)이지만 명명 패턴은 동일하게 맞춘다.
- Produces: `buildWorkloadEvidenceSentences(input: WorkloadEvidenceInput): string[]` — `WorkloadEvidenceInput.anomalyType: string` → `anomalyTypes: string[]`로 시그니처 변경(breaking, 이 파일의 유일한 export 함수라 외부 호출부는 이 컴포넌트 내부(`WorkloadEvidenceDetails`)와 테스트뿐)

- [ ] **Step 1: 실패하는 테스트로 `contributorsApi.test.ts`의 `fetchContributionScore` 부분 교체**

`App/frontend/src/contributors/libs/utils/contributorsApi.test.ts`의
`describe("fetchContributionScore", ...)` 블록(30번 줄 이후) 전체를 다음으로 교체:

```typescript
describe("fetchContributionScore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("converts snake_case response to camelCase", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      schema_version: "1.0",
      project_id: 1,
      members: [
        {
          assignee_id: "3",
          workload_component: 100.0,
          task_component: 80.0,
          meeting_component: 80.0,
          contribution_score: 86.7,
          anomaly_types: ["업무량 편중 의심"],
          difficulty_score: 90.0,
          workload_score: 85.0,
          allocation_score: 10.0,
          task_count_active_rel: 1.8,
          task_count_total_rel: 1.5,
          difficulty_total_rel: 1.4,
          overdue_count: 2,
        },
      ],
      note: null,
      team_mean_completion: 0.65,
    });

    const result = await fetchContributionScore(1);

    expect(apiFetch).toHaveBeenCalledWith("/ai/contribution/score", {
      method: "POST",
      body: JSON.stringify({ project_id: 1 }),
    });
    expect(result).toEqual({
      members: [
        {
          assigneeId: "3",
          workloadComponent: 100.0,
          taskComponent: 80.0,
          meetingComponent: 80.0,
          contributionScore: 86.7,
          anomalyTypes: ["업무량 편중 의심"],
          difficultyScore: 90.0,
          workloadScore: 85.0,
          allocationScore: 10.0,
          taskCountActiveRel: 1.8,
          taskCountTotalRel: 1.5,
          difficultyTotalRel: 1.4,
          overdueCount: 2,
        },
      ],
      note: null,
      teamMeanCompletion: 0.65,
    });
  });

  it("passes through a non-null note", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      schema_version: "1.0",
      project_id: 1,
      members: [],
      note: "배정된 업무가 없어 기여도 점수를 계산할 수 없습니다.",
      team_mean_completion: null,
    });

    const result = await fetchContributionScore(1);

    expect(result).toEqual({
      members: [],
      note: "배정된 업무가 없어 기여도 점수를 계산할 수 없습니다.",
      teamMeanCompletion: null,
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run (from `App/frontend`): `npx vitest run src/contributors/libs/utils/contributorsApi.test.ts`
Expected: FAIL — `result`에 `anomalyType: undefined`가 나오거나(구 매핑 코드가 `anomaly_types`가
아닌 `anomaly_type`을 읽으려다 실패) `toEqual` 불일치

- [ ] **Step 3: `contributorsApi.ts` 갱신**

`App/frontend/src/contributors/libs/utils/contributorsApi.ts`의 `RawContributionMemberScore`
(31-42번 줄), `ContributionMemberScoreDto`(52-63번 줄), 매핑부(80-91번 줄)를 다음으로 교체:

```typescript
interface RawContributionMemberScore {
  assignee_id: string;
  workload_component: number;
  task_component: number;
  meeting_component: number;
  contribution_score: number;
  anomaly_types: string[];
  difficulty_score: number;
  workload_score: number;
  allocation_score: number;
  task_count_active_rel: number;
  task_count_total_rel: number;
  difficulty_total_rel: number;
  overdue_count: number;
}

interface RawContributionScoreData {
  schema_version: string;
  project_id: number;
  members: RawContributionMemberScore[];
  note: string | null;
  team_mean_completion: number | null;
}

export interface ContributionMemberScoreDto {
  assigneeId: string;
  workloadComponent: number;
  taskComponent: number;
  meetingComponent: number;
  contributionScore: number;
  anomalyTypes: string[];
  difficultyScore: number;
  workloadScore: number;
  allocationScore: number;
  taskCountActiveRel: number;
  taskCountTotalRel: number;
  difficultyTotalRel: number;
  overdueCount: number;
}

export interface ContributionScoreResult {
  members: ContributionMemberScoreDto[];
  note: string | null;
  // anomaly_types(업무량 편중/난이도 편중/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율(0~1).
  // 팀원이 없어 계산 자체가 없었으면 null.
  teamMeanCompletion: number | null;
}

export async function fetchContributionScore(projectId: number): Promise<ContributionScoreResult> {
  const data = await apiFetch<RawContributionScoreData>("/ai/contribution/score", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  });

  return {
    members: data.members.map((m) => ({
      assigneeId: m.assignee_id,
      workloadComponent: m.workload_component,
      taskComponent: m.task_component,
      meetingComponent: m.meeting_component,
      contributionScore: m.contribution_score,
      anomalyTypes: m.anomaly_types,
      difficultyScore: m.difficulty_score,
      workloadScore: m.workload_score,
      allocationScore: m.allocation_score,
      taskCountActiveRel: m.task_count_active_rel,
      taskCountTotalRel: m.task_count_total_rel,
      difficultyTotalRel: m.difficulty_total_rel,
      overdueCount: m.overdue_count,
    })),
    note: data.note,
    teamMeanCompletion: data.team_mean_completion,
  };
}
```

(파일 상단의 `fetchContributionReport`/`MemberContributionDto` 부분은 이번 변경과 무관하므로
그대로 둔다.)

- [ ] **Step 4: 테스트 재실행 → 통과 확인**

Run: `npx vitest run src/contributors/libs/utils/contributorsApi.test.ts`
Expected: `3 passed`(fetchContributionReport 1개 + fetchContributionScore 2개)

- [ ] **Step 5: 커밋**

```bash
git add App/frontend/src/contributors/libs/utils/contributorsApi.ts \
        App/frontend/src/contributors/libs/utils/contributorsApi.test.ts
git commit -m "feat: contributorsApi에 anomalyTypes 배열 + 축별 점수 필드 매핑 추가"
```

---

### Task 10: `MemberDrilldownPanel.tsx` — 다중 배지 렌더링 + 축별 근거 문구 생성기

**Files:**
- Modify: `App/frontend/src/contributors/components/MemberDrilldownPanel.tsx:18-67` (`WorkloadEvidenceInput`, `buildWorkloadEvidenceSentences`)
- Modify: `App/frontend/src/contributors/components/MemberDrilldownPanel.tsx:225-289` (`ANOMALY_BADGE_STYLE`, `WorkloadEvidenceDetails`)
- Modify: `App/frontend/src/contributors/components/MemberDrilldownPanel.test.tsx:239-410` (workload mode + `buildWorkloadEvidenceSentences` describe 블록)

**Interfaces:**
- Consumes: `ContributionMemberScoreDto`(Task 9에서 `anomalyTypes: string[]`로 갱신됨)
- Produces: `buildWorkloadEvidenceSentences(input: WorkloadEvidenceInput): string[]` — `WorkloadEvidenceInput.anomalyTypes: string[]`(breaking, 구 `anomalyType: string` 대체)

- [ ] **Step 1: 실패하는 테스트로 관련 테스트 블록 전체 교체**

`App/frontend/src/contributors/components/MemberDrilldownPanel.test.tsx`의
`describe("MemberDrilldownPanel workload mode", ...)` 블록(239-311번 줄)과
`describe("buildWorkloadEvidenceSentences", ...)` 블록(313-410번 줄) 전체를 다음으로 교체:

```typescript
describe("MemberDrilldownPanel workload mode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeEvidence(overrides: Partial<ContributionMemberScoreDto> = {}): ContributionMemberScoreDto {
    return {
      assigneeId: "1", workloadComponent: 17.5, taskComponent: 80.0, meetingComponent: 80.0,
      contributionScore: 60.0, anomalyTypes: ["배정량 불균형"], difficultyScore: 10.0,
      workloadScore: 10.0, allocationScore: 90.0, taskCountActiveRel: 0.3, taskCountTotalRel: 0.3,
      difficultyTotalRel: 0.9, overdueCount: 0, ...overrides,
    };
  }

  it("mode가 workload이면 신규 fetch 없이 즉시 배지와 근거 문장을 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}} workloadEvidence={makeEvidence()} teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("배정량 불균형")).toBeInTheDocument();
    expect(screen.getByText("배정된 업무 자체가 팀 평균 대비 0.3배 적습니다.")).toBeInTheDocument();
    expect(fetchAttendanceDetail).not.toHaveBeenCalled();
  });

  it("anomalyTypes에 업무량 편중 의심이 있으면 해당 배지를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
        workloadEvidence={makeEvidence({ anomalyTypes: ["업무량 편중 의심"], taskCountActiveRel: 1.8 })}
        teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("업무량 편중 의심")).toBeInTheDocument();
  });

  it("anomalyTypes에 라벨이 두 개면 배지도 두 개 표시한다(배정량 불균형 + 난이도 편중 의심)", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
        workloadEvidence={makeEvidence({
          anomalyTypes: ["배정량 불균형", "난이도 편중 의심"],
          difficultyTotalRel: 1.6,
        })}
        teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("배정량 불균형")).toBeInTheDocument();
    expect(screen.getByText("난이도 편중 의심")).toBeInTheDocument();
  });

  it("workloadEvidence가 없으면 에러 문구를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("편중도 근거를 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("teamMeanCompletion이 없으면 완료율 비교 없이 실측값만 표시한다(팀 평균 오도 방지)", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}} workloadEvidence={makeEvidence()}
      />
    );

    expect(screen.getByText(/팀 평균값을 불러오지 못해 비교는 표시하지 않습니다/)).toBeInTheDocument();
  });

  it("구버전 FastAPI 혼합 배포로 신규 필드가 null이면 크래시 대신 안내 문구를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
        workloadEvidence={makeEvidence({ taskCountActiveRel: null as unknown as number })}
        teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("편중도 근거 데이터가 불완전합니다. 새로고침 후 다시 시도해주세요.")).toBeInTheDocument();
  });
});

describe("buildWorkloadEvidenceSentences", () => {
  it("업무량 편중 의심: 업무량/난이도/지연/완료율 문장을 모두 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: ["업무량 편중 의심"],
      taskCountActiveRel: 1.8,
      taskCountTotalRel: 1.5,
      difficultyTotalRel: 1.4,
      overdueCount: 2,
      completionRate: 0.4,
      teamMeanCompletionRate: 0.6,
    });

    expect(sentences).toEqual([
      "진행 중인 업무가 팀 평균 대비 1.8배 많습니다.",
      "업무 완료율은 40%로 팀 평균(60%)보다 낮습니다.",
    ]);
  });

  it("난이도 편중 의심: 총 난이도 부담과 연체 문장을 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: ["난이도 편중 의심"],
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyTotalRel: 1.7,
      overdueCount: 3,
      completionRate: 0.5,
      teamMeanCompletionRate: 0.5,
    });

    expect(sentences).toEqual([
      "담당 업무의 전체 난이도 부담이 팀 평균 대비 1.7배 높습니다.",
      "마감이 지난 업무가 3건 있습니다.",
    ]);
  });

  it("배정량 불균형: 배정량 감소와 완료율 문장을 생성한다(진행중 업무 개수가 아니라 전체 배정량 기준)", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: ["배정량 불균형"],
      taskCountActiveRel: 0.0,
      taskCountTotalRel: 0.3,
      difficultyTotalRel: 0.9,
      overdueCount: 0,
      completionRate: 0.95,
      teamMeanCompletionRate: 0.7,
    });

    expect(sentences).toEqual([
      "배정된 업무 자체가 팀 평균 대비 0.3배 적습니다.",
      "업무 완료율은 95%로 팀 평균(70%)보다 높습니다.",
    ]);
  });

  it("여러 축이 동시에 이상치면 각 축의 문장이 순서대로 모두 생성된다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: ["난이도 편중 의심", "배정량 불균형"],
      taskCountActiveRel: 0.2,
      taskCountTotalRel: 0.3,
      difficultyTotalRel: 1.6,
      overdueCount: 0,
      completionRate: 0.9,
      teamMeanCompletionRate: 0.5,
    });

    expect(sentences).toEqual([
      "담당 업무의 전체 난이도 부담이 팀 평균 대비 1.6배 높습니다.",
      "배정된 업무 자체가 팀 평균 대비 0.3배 적습니다.",
      "업무 완료율은 90%로 팀 평균(50%)보다 높습니다.",
    ]);
  });

  it("정상(빈 배열): 편중이 없다는 문장 하나만 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: [],
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyTotalRel: 1.0,
      overdueCount: 0,
      completionRate: 0.8,
      teamMeanCompletionRate: 0.8,
    });

    expect(sentences).toEqual(["팀 평균과 비교했을 때 업무량·난이도·완료율 모두 특별한 편중이 없습니다."]);
  });

  it("teamMeanCompletionRate가 null이면 팀 평균과 비교하지 않고 실측 완료율만 표시한다(팀 평균 오도 방지 회귀 테스트)", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyTypes: ["업무량 편중 의심"],
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyTotalRel: 1.0,
      overdueCount: 0,
      completionRate: 0.3,
      teamMeanCompletionRate: null,
    });

    expect(sentences).toEqual([
      "업무 완료율은 30%입니다. (팀 평균값을 불러오지 못해 비교는 표시하지 않습니다.)",
    ]);
  });
});
```

(주의: 새 "업무량 편중 의심" 문장에서 구 버전의 "담당 업무의 평균 난이도가 팀 평균보다
N배 높습니다." 줄은 **삭제**됐다 — 난이도 관련 문구는 이제 "난이도 편중 의심" 축 전용이고,
업무량 축은 진행중 개수+완료율만 본다. 이건 3축 분리라는 설계 의도와 일치하는 의도된 변경.)

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run src/contributors/components/MemberDrilldownPanel.test.tsx`
Expected: FAIL — `buildWorkloadEvidenceSentences`가 아직 `anomalyType`(단수) 프로퍼티를 기대하는
타입이라 TypeScript 컴파일 에러 또는 `input.anomalyTypes`가 `undefined`라 런타임 에러

- [ ] **Step 3: `MemberDrilldownPanel.tsx`의 `WorkloadEvidenceInput`/`buildWorkloadEvidenceSentences` 갱신**

`WorkloadEvidenceInput` 인터페이스(18-31번 줄)와 `buildWorkloadEvidenceSentences`
함수(35-67번 줄) 전체를 다음으로 교체:

```typescript
export interface WorkloadEvidenceInput {
  // 이상치로 판정된 축들의 라벨 목록. 정상이면 빈 배열. 한 사람이 여러 축에서 동시에
  // 이상치일 수 있으므로(예: 배정량은 적은데 난이도는 몰림) 배열이다.
  anomalyTypes: string[];
  taskCountActiveRel: number;
  // "배정량 불균형" 문구 전용: 애초에 배정받은 전체 업무 수의 팀 평균 대비 비율.
  // taskCountActiveRel(진행중 업무 비율)은 배정된 업무를 전부 끝낸 사람도 0이 되므로
  // 이 근거 문구에는 이 필드를 쓴다(백엔드 anomaly_types 판정과 동일한 기준).
  taskCountTotalRel: number;
  // "난이도 편중" 문구 전용: assignee별 난이도 합산(sum)의 팀 평균 대비 비율. 건당 평균이
  // 아니라 총부담이라 업무 개수 효과가 반영된다(어려운 일 3건과 20건을 구분할 수 있음).
  difficultyTotalRel: number;
  overdueCount: number;
  completionRate: number;
  // anomaly_types 판정에 실제로 쓰인 팀 평균 완료율(0~1). 없으면(팀 평균을
  // 아직 못 불러온 경우) "팀 평균보다 높음/낮음" 같은 단정적 비교 문구를 만들지 않는다.
  teamMeanCompletionRate: number | null;
}

// LLM 미개입 결정론적 문장 생성기 — 근거가 이미 계산된 수치이므로 자연어 생성에
// 불확실성을 끌어들일 이유가 없다. anomalyTypes 배열을 순회하며 각 축의 문장을 이어붙인다.
export function buildWorkloadEvidenceSentences(input: WorkloadEvidenceInput): string[] {
  const sentences: string[] = [];
  const activeMultiple = input.taskCountActiveRel.toFixed(1);
  const totalMultiple = input.taskCountTotalRel.toFixed(1);
  const difficultyMultiple = input.difficultyTotalRel.toFixed(1);
  const completionPct = Math.round(input.completionRate * 100);
  // 팀 평균값이 있을 때만 "팀 평균 N%보다 낮음/높음"처럼 실측 비교를 보여준다.
  // 팀 평균을 모르면서 방향만 단정하면 심사 근거를 오도할 수 있다(리뷰 지적사항).
  const teamMeanPct = input.teamMeanCompletionRate != null ? Math.round(input.teamMeanCompletionRate * 100) : null;
  const completionSentence = (comparison: "낮습니다" | "높습니다") =>
    teamMeanPct != null
      ? `업무 완료율은 ${completionPct}%로 팀 평균(${teamMeanPct}%)보다 ${comparison}.`
      : `업무 완료율은 ${completionPct}%입니다. (팀 평균값을 불러오지 못해 비교는 표시하지 않습니다.)`;

  if (input.anomalyTypes.length === 0) {
    return ["팀 평균과 비교했을 때 업무량·난이도·완료율 모두 특별한 편중이 없습니다."];
  }

  if (input.anomalyTypes.includes("난이도 편중 의심")) {
    sentences.push(`담당 업무의 전체 난이도 부담이 팀 평균 대비 ${difficultyMultiple}배 높습니다.`);
    if (input.overdueCount > 0) {
      sentences.push(`마감이 지난 업무가 ${input.overdueCount}건 있습니다.`);
    }
  }
  if (input.anomalyTypes.includes("업무량 편중 의심")) {
    sentences.push(`진행 중인 업무가 팀 평균 대비 ${activeMultiple}배 많습니다.`);
  }
  if (input.anomalyTypes.includes("배정량 불균형")) {
    sentences.push(`배정된 업무 자체가 팀 평균 대비 ${totalMultiple}배 적습니다.`);
  }

  // 완료율 방향은 축에 따라 다르다: 업무량 편중은 "낮은 완료율", 배정량 불균형은 "높은
  // 완료율"이 전형적인 신호다. 둘 다 없으면(난이도 편중만 걸린 경우) 완료율 문장은 생략 —
  // 난이도 편중은 완료율과 직접 관련이 없으므로.
  if (input.anomalyTypes.includes("업무량 편중 의심")) {
    sentences.push(completionSentence("낮습니다"));
  } else if (input.anomalyTypes.includes("배정량 불균형")) {
    sentences.push(completionSentence("높습니다"));
  }

  return sentences;
}
```

- [ ] **Step 4: `ANOMALY_BADGE_STYLE`/`WorkloadEvidenceDetails` 갱신 — 다중 배지 렌더링**

`ANOMALY_BADGE_STYLE`(225-231번 줄)과 `WorkloadEvidenceDetails`(243-289번 줄)를 다음으로 교체:

```typescript
const ANOMALY_BADGE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  "난이도 편중 의심": { label: "난이도 편중 의심", color: "#DC2626", bg: "#FEF2F2" },
  "업무량 편중 의심": { label: "업무량 편중 의심", color: "#EA580C", bg: "#FFF7ED" },
  // "저활동 의심"이 아니라 중립적 라벨을 쓴다: 배정량이 팀 평균보다 적다는 관찰 사실은
  // 맞지만, 완료율이 높은 사람에게도 뜨므로(예: 배정받은 일을 전부 끝낸 경우) 태만을
  // 단정하는 표현은 피하고 심사자가 직접 판단하도록 한다.
  "배정량 불균형": { label: "배정량 불균형", color: "#D97706", bg: "#FFFBEB" },
  "난이도 이상 패턴(방향 불명확)": { label: "난이도 이상 패턴", color: "#64748B", bg: "#F1F5F9" },
  "업무량 이상 패턴(방향 불명확)": { label: "업무량 이상 패턴", color: "#64748B", bg: "#F1F5F9" },
  "배정 이상 패턴(방향 불명확)": { label: "배정 이상 패턴", color: "#64748B", bg: "#F1F5F9" },
};

interface WorkloadEvidenceDetailsProps {
  workloadEvidence: ContributionMemberScoreDto | undefined;
  // anomaly_types 판정에 쓰인 실제 팀 평균 완료율(0~1). ContributorsView가
  // fetchContributionScore()의 team_mean_completion을 그대로 내려준다.
  teamMeanCompletion: number | null;
}

// 신규 fetch 없음 — ContributorsView가 페이지 진입 시 이미 로드해 둔 contributionByMemberId를
// 그대로 prop으로 받아 렌더링한다(업무/회의 모드와 달리 로딩 상태가 없다).
function WorkloadEvidenceDetails({ workloadEvidence, teamMeanCompletion }: WorkloadEvidenceDetailsProps) {
  if (!workloadEvidence) {
    return <p className="p-4 text-xs text-muted-foreground">편중도 근거를 불러오지 못했습니다.</p>;
  }

  // taskCountActiveRel/difficultyTotalRel/overdueCount는 TS 타입상 number지만, Spring
  // ContributionMemberScoreDto의 실제 필드는 boxed Double/Integer라 구버전 FastAPI가
  // 이 신규 필드를 응답에 안 담아 보내면(혼합 배포 롤백 등) 런타임에 null이 올 수 있다.
  // toFixed() 등에서 크래시하지 않도록 수치 필드가 전부 유효한 숫자인지 먼저 확인한다.
  const numericFields = [
    workloadEvidence.taskCountActiveRel,
    workloadEvidence.taskCountTotalRel,
    workloadEvidence.difficultyTotalRel,
    workloadEvidence.overdueCount,
    workloadEvidence.taskComponent,
  ];
  if (numericFields.some((v) => v == null || Number.isNaN(v))) {
    return <p className="p-4 text-xs text-muted-foreground">편중도 근거 데이터가 불완전합니다. 새로고침 후 다시 시도해주세요.</p>;
  }

  const badges = workloadEvidence.anomalyTypes.map((type) => ANOMALY_BADGE_STYLE[type]).filter(Boolean);
  const sentences = buildWorkloadEvidenceSentences({
    anomalyTypes: workloadEvidence.anomalyTypes,
    taskCountActiveRel: workloadEvidence.taskCountActiveRel,
    taskCountTotalRel: workloadEvidence.taskCountTotalRel,
    difficultyTotalRel: workloadEvidence.difficultyTotalRel,
    overdueCount: workloadEvidence.overdueCount,
    completionRate: workloadEvidence.taskComponent / 100,
    teamMeanCompletionRate: teamMeanCompletion,
  });

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {badges.length === 0 ? (
          <span
            className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ color: "#64748B", background: "#F1F5F9" }}
          >
            정상
          </span>
        ) : (
          badges.map((badge, i) => (
            <span
              key={i}
              className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ color: badge.color, background: badge.bg }}
            >
              {badge.label}
            </span>
          ))
        )}
      </div>
      <div className="space-y-1.5">
        {sentences.map((sentence, i) => (
          <p key={i} className="text-xs text-foreground"><span aria-hidden="true">· </span><span>{sentence}</span></p>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `npx vitest run src/contributors/components/MemberDrilldownPanel.test.tsx`
Expected: 전부 통과(기존 21개 tasks/meetings 테스트 + workload mode 7개 + buildWorkloadEvidenceSentences 7개)

- [ ] **Step 6: `ContributorsView.test.tsx`의 mock 데이터 갱신**

`App/frontend/src/contributors/screen/ContributorsView.test.tsx`에서 `anomalyType: "..."`로 돼
있는 5곳(88, 205, 402, 407, 456번 줄)을 각각 `anomalyTypes: [...]` 배열로 바꾸고,
`difficultyAvgRel`이 있다면 `difficultyTotalRel`로, `difficultyScore`/`workloadScore`/
`allocationScore` 필드가 mock 객체 타입에 필요하면 추가한다. 예:
`anomalyType: "배정량 불균형"` → `anomalyTypes: ["배정량 불균형"]`,
`anomalyType: "정상"` → `anomalyTypes: []`.

(이 파일은 `MemberDrilldownPanel`을 직접 렌더링하지 않고 `contributionByMemberId`를 prop으로
넘기기만 하므로, 로직 자체는 안 바뀌고 mock 객체의 타입만 새 인터페이스에 맞추면 된다.)

- [ ] **Step 7: 프론트 전체(contributors 디렉터리) 회귀 확인**

Run: `npx vitest run src/contributors`
Expected: 전부 통과, 실패 0건

- [ ] **Step 8: 커밋**

```bash
git add App/frontend/src/contributors/components/MemberDrilldownPanel.tsx \
        App/frontend/src/contributors/components/MemberDrilldownPanel.test.tsx \
        App/frontend/src/contributors/screen/ContributorsView.test.tsx
git commit -m "feat: MemberDrilldownPanel이 다중 배지 + 축별 근거 문구를 표시하도록 갱신"
```

---

### Task 11: `ContributorsView.tsx`의 구 필드명 주석 정리

**Files:**
- Modify: `App/frontend/src/contributors/screen/ContributorsView.tsx:181`

**Interfaces:**
- (해당 없음 — 주석 텍스트만 변경, 로직/타입 변경 없음)

이 파일 본문 코드에는 `anomalyType`을 직접 참조하는 곳이 없다(검색 결과 179-181번 줄의 주석
한 줄만 구 필드명 `anomaly_type`을 언급). 코드는 이미 `contributionByMemberId`를 통째로
`MemberDrilldownPanel`에 넘기기만 하므로 Task 10에서 타입이 바뀌면 자동으로 맞다 — 이 태스크는
설명 주석만 최신화한다.

- [ ] **Step 1: 주석 갱신**

`App/frontend/src/contributors/screen/ContributorsView.tsx:181` 줄을 다음으로 교체:

```typescript
  // anomaly_types(업무량 편중/난이도 편중/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율 — 편중도 근거
```

- [ ] **Step 2: 프론트 빌드 타입체크로 회귀 없는지 확인**

Run (from `App/frontend`): `npx tsc --noEmit -p .`
Expected: Task 9, 10에서 변경한 타입들과 관련된 에러 0건(사전 존재하던 무관한 에러가 있다면
이번 변경으로 새로 생긴 게 아닌지 diff로 확인)

- [ ] **Step 3: 커밋**

```bash
git add App/frontend/src/contributors/screen/ContributorsView.tsx
git commit -m "docs: ContributorsView 주석을 anomaly_types 필드명으로 갱신"
```

---

### Task 12: `workloadScoreApi.ts` + `WorkloadPage.tsx` — 대시보드 화면도 3축 구조로 갱신

**Files:**
- Modify: `App/frontend/src/dashboard/libs/utils/workloadScoreApi.ts` (전체)
- Modify: `App/frontend/src/dashboard/screen/detail/WorkloadPage.tsx:44-68, 108-145, 247-266, 279-307` (여러 지점)

**Interfaces:**
- Consumes: Spring `WorkloadScoreMemberDto`(Task 8에서 `anomaly_types: List<String>`로 갱신됨) — 이 필드는 dashboard 엔드포인트가 그대로 통과시키므로 raw JSON 구조가 동일하게 바뀐다
- Produces: `WorkloadScoreMemberDto`(frontend, workloadScoreApi.ts) — `anomalyTypes: string[]`, `difficultyScore`/`workloadScore`/`allocationScore`, `difficultyTotalRel`

이 태스크는 자동화 테스트 파일이 없는 화면이라(Global Constraints 참고), TDD의 "실패하는
테스트" 단계 대신 **타입 컴파일 실패 → 코드 수정 → 컴파일 통과 확인**으로 안전망을 만든다.

- [ ] **Step 1: `workloadScoreApi.ts` 전체 교체**

`App/frontend/src/dashboard/libs/utils/workloadScoreApi.ts` 전체를 다음으로 교체:

```typescript
import { apiFetch } from "../../../global/api/apiClient";

// Spring dashboard.workload-score 엔드포인트는 ml_workload_score(FastAPI) 응답을
// 필드명 그대로 통과시키므로(dashboard.ts의 다른 camelCase DTO와 달리) snake_case로 온다.
interface RawWorkloadScoreMember {
  assignee_id: string;
  task_count_total: number;
  completion_rate: number;
  overload_score: number;
  is_anomaly: boolean;
  anomaly_types: string[];
  difficulty_score: number;
  workload_score: number;
  allocation_score: number;
  task_count_active_rel: number;
  task_count_total_rel: number;
  difficulty_total_rel: number;
  overdue_count: number;
}

interface RawWorkloadScoreData {
  schema_version: string;
  project_id: number;
  source: string;
  method: string;
  members: RawWorkloadScoreMember[];
  note: string | null;
  team_mean_completion: number | null;
}

export interface WorkloadScoreMemberDto {
  assigneeId: string;
  taskCountTotal: number;
  completionRate: number;
  overloadScore: number;
  isAnomaly: boolean;
  anomalyTypes: string[];
  difficultyScore: number;
  workloadScore: number;
  allocationScore: number;
  taskCountActiveRel: number;
  taskCountTotalRel: number;
  difficultyTotalRel: number;
  overdueCount: number;
}

export interface WorkloadScoreResult {
  source: string;
  method: string;
  members: WorkloadScoreMemberDto[];
  note: string | null;
  // anomaly_types(업무량 편중/난이도 편중/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율(0~1).
  teamMeanCompletion: number | null;
}

export async function fetchWorkloadScore(projectId: string | number): Promise<WorkloadScoreResult> {
  const data = await apiFetch<RawWorkloadScoreData>(`/projects/${projectId}/dashboard/workload-score`);
  return {
    source: data.source,
    method: data.method,
    members: data.members.map(m => ({
      assigneeId: m.assignee_id,
      taskCountTotal: m.task_count_total,
      completionRate: m.completion_rate,
      overloadScore: m.overload_score,
      isAnomaly: m.is_anomaly,
      anomalyTypes: m.anomaly_types,
      difficultyScore: m.difficulty_score,
      workloadScore: m.workload_score,
      allocationScore: m.allocation_score,
      taskCountActiveRel: m.task_count_active_rel,
      taskCountTotalRel: m.task_count_total_rel,
      difficultyTotalRel: m.difficulty_total_rel,
      overdueCount: m.overdue_count,
    })),
    note: data.note,
    teamMeanCompletion: data.team_mean_completion,
  };
}
```

- [ ] **Step 2: `WorkloadPage.tsx`의 `ANOMALY_BADGE` 갱신**

`App/frontend/src/dashboard/screen/detail/WorkloadPage.tsx:65-68`의 `ANOMALY_BADGE` 상수를
다음으로 교체:

```typescript
const ANOMALY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "난이도 편중 의심": { label: "난이도 편중 의심", color: "#DC2626", bg: "#FEF2F2" },
  "업무량 편중 의심": { label: "업무량 편중 의심", color: "#EA580C", bg: "#FFF7ED" },
  "배정량 불균형": { label: "배정량 불균형", color: "#D97706", bg: "#FFFBEB" },
};
```

- [ ] **Step 3: `isMemberOverloaded`/`categoryColorFor`를 anomalyTypes 배열 기준으로 변경**

`WorkloadPage.tsx:108-120`을 다음으로 교체:

```typescript
  const workloadScoreByAssignee = new Map<string, WorkloadScoreMemberDto>(
    (workloadScore?.members ?? []).map(member => [member.assigneeId, member])
  );
  // isAnomaly는 세 축(업무량 편중/난이도 편중/배정량 불균형) 전부를 true로 묶어서 주기 때문에,
  // 그대로 쓰면 "배정량 불균형"만 걸린 팀원까지 "과부하 위험"으로 잘못 표시된다 —
  // anomalyTypes로 업무량 편중만 걸러낸다.
  const isMemberOverloaded = (member: (typeof workload)[number]) =>
    workloadScoreByAssignee.get(member.assigneeId)?.anomalyTypes.includes("업무량 편중 의심") ?? false;
  // 완료율 비교 영역에서는 팀원 프로필 색상 대신, 범례와 동일한 편중 범주 색상을 쓴다.
  // 한 사람이 여러 축에서 동시에 이상치일 수 있으므로 우선순위(업무량 편중 > 난이도 편중 >
  // 배정량 불균형)를 정해 대표색 하나를 고른다.
  const ANOMALY_COLOR_PRIORITY = ["업무량 편중 의심", "난이도 편중 의심", "배정량 불균형"];
  const categoryColorFor = (member: (typeof workload)[number]) => {
    const anomalyTypes = workloadScoreByAssignee.get(member.assigneeId)?.anomalyTypes ?? [];
    const primaryType = ANOMALY_COLOR_PRIORITY.find(type => anomalyTypes.includes(type));
    return primaryType ? ANOMALY_BADGE[primaryType]?.color ?? NORMAL_CATEGORY_COLOR : NORMAL_CATEGORY_COLOR;
  };
```

- [ ] **Step 4: `overloadedByMl`/`underloadedByMl`을 세 그룹으로 교체하고 `workloadInsightText` 갱신**

`WorkloadPage.tsx:122-145`를 다음으로 교체:

```typescript
  const workloadHeavyMembers = (workloadScore?.members ?? []).filter(member => member.anomalyTypes.includes("업무량 편중 의심"));
  const difficultyHeavyMembers = (workloadScore?.members ?? []).filter(member => member.anomalyTypes.includes("난이도 편중 의심"));
  const allocationImbalancedMembers = (workloadScore?.members ?? []).filter(member => member.anomalyTypes.includes("배정량 불균형"));
  const memberNameFor = (assigneeId: string) => {
    const index = workload.findIndex(entry => entry.assigneeId === assigneeId);
    const assigneeName = index >= 0 ? workload[index].assigneeName : null;
    return resolveMemberDisplay(assigneeName, index >= 0 ? index : 0, assigneeId).name;
  };
  // "과부하 위험" 카드의 서브텍스트용 - overloadScore(AI 편중 점수)는 세 축 모두 높게 나올 수
  // 있으므로, 반드시 anomalyTypes에 "업무량 편중 의심"이 포함된 사람 중에서만 골라야
  // 다른 축으로 이상치인 팀원 이름이 잘못 뜨지 않는다.
  const topOverloadedMember = workloadHeavyMembers.reduce<WorkloadScoreMemberDto | null>(
    (top, member) => (!top || member.overloadScore > top.overloadScore ? member : top),
    null
  );
  const topOverloadedName = topOverloadedMember ? memberNameFor(topOverloadedMember.assigneeId) : null;
  const workloadInsightText = workloadScoreLoading
    ? "AI가 팀원별 업무 편중도를 분석하고 있습니다..."
    : !workloadScore || workloadScore.members.length === 0
      ? (workloadScore?.note ?? "편중 점수를 계산할 업무 데이터가 없습니다.")
      : workloadHeavyMembers.length === 0 && difficultyHeavyMembers.length === 0 && allocationImbalancedMembers.length === 0
        ? "AI 분석 결과 팀원 간 뚜렷한 업무 편중은 감지되지 않았습니다."
        : [
            ...workloadHeavyMembers.map(member => `${memberNameFor(member.assigneeId)}님 업무량 편중 의심(${Math.round(member.overloadScore)}점)`),
            ...difficultyHeavyMembers.map(member => `${memberNameFor(member.assigneeId)}님 난이도 편중 의심(${Math.round(member.overloadScore)}점)`),
            ...allocationImbalancedMembers.map(member => `${memberNameFor(member.assigneeId)}님 배정량 불균형(${Math.round(member.overloadScore)}점)`),
          ].join(", ") + " — 업무 재배분을 검토해보세요.";
```

- [ ] **Step 5: 완료율 비교 영역의 `isOverload`/`isUnderload` → 3축 배지로 교체**

`WorkloadPage.tsx:236-263`의 범례(238-242번 줄)와 카드 내부 배지(247-257번 줄)를 다음으로
교체:

```typescript
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground mb-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: ANOMALY_BADGE["업무량 편중 의심"].color }} />업무량 편중(AI 편중 점수 상위 이상치)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: ANOMALY_BADGE["난이도 편중 의심"].color }} />난이도 편중(어려운 업무 몰림)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: ANOMALY_BADGE["배정량 불균형"].color }} />배정량 불균형(배정 자체가 적음)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: NORMAL_CATEGORY_COLOR }} />정상(이상치 아님)</span>
          </div>
          <div className="space-y-4">
            {!summaryLoading && !pageRefreshing && workload.map((entry, index) => {
              const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
              const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
              const anomalyTypes = workloadScoreByAssignee.get(entry.assigneeId)?.anomalyTypes ?? [];
              return (
                <div key={entry.assigneeId}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: member.color }}>{member.initials}</div>
                      <span className="font-medium text-foreground">{member.name}</span>
                      {anomalyTypes.includes("업무량 편중 의심") && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-600">업무량 편중</span>}
                      {anomalyTypes.includes("난이도 편중 의심") && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-600">난이도 편중</span>}
                      {anomalyTypes.includes("배정량 불균형") && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700">배정량 불균형</span>}
                    </div>
                    <span className="font-semibold" style={{ color: categoryColorFor(entry) }}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: categoryColorFor(entry) }} /></div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{entry.done}/{entry.total}개 · 블로커 {entry.blocked}개</div>
                </div>
              );
            })}
```

(`isOverload`/`isUnderload` 지역 변수는 이 블록에서 더 이상 안 쓰므로 삭제됐다 —
`anomalyTypes` 배열을 직접 참조하는 구조로 대체됐다.)

- [ ] **Step 6: 팀원 카드 그리드의 배지 렌더링을 다중 배지로 교체**

`WorkloadPage.tsx:274-319`의 카드 반복문 내부, 특히 279-307번 줄의 `scoreEntry`/`isOverload`/
`anomalyBadge` 관련 부분을 다음으로 교체:

```typescript
        {!summaryLoading && !pageRefreshing && workload.map((entry, index) => {
          const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
          const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
          const isSelected = selectedMember === entry.assigneeId;
          const scoreEntry = workloadScoreByAssignee.get(entry.assigneeId);
          const isOverload = isMemberOverloaded(entry);
          const anomalyBadges = (scoreEntry?.anomalyTypes ?? [])
            .map(type => ANOMALY_BADGE[type])
            .filter((badge): badge is { label: string; color: string; bg: string } => Boolean(badge));
          return (
            <button key={entry.assigneeId} onClick={() => setSelectedMember(isSelected ? null : entry.assigneeId)} className={`bg-card rounded-xl p-5 border-2 cursor-pointer transition-all shadow-sm hover:shadow-md text-left ${isSelected ? "border-blue-400" : isOverload ? "border-red-200" : "border-border"}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: member.color }}>{member.initials}</div>
                  <div><div className="text-sm font-semibold text-foreground">{member.name}</div><div className="text-xs text-muted-foreground">{member.role}</div></div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {isOverload && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">과부하 위험</span>}
                  <span className="text-lg font-bold" style={{ color: categoryColorFor(entry) }}>{pct}%</span>
                </div>
              </div>
              {scoreEntry && (
                <div className="flex items-center justify-between gap-2 mb-3 px-2.5 py-1.5 rounded-lg bg-muted/60">
                  {anomalyBadges.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {anomalyBadges.map((badge, i) => (
                        <span key={i} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: badge.color, background: badge.bg }}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    AI 업무 편중 점수 <span className="font-bold text-foreground">{Math.round(scoreEntry.overloadScore)}</span>/100
                  </span>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[{ label: "전체", value: entry.total, color: "#64748B" }, { label: "완료", value: entry.done, color: "#10B981" }, { label: "진행", value: entry.inProgress, color: "#3B5BDB" }, { label: "블로커", value: entry.blocked, color: "#EF4444" }].map(item => (
                  <div key={item.label} className="text-center p-1.5 rounded-lg bg-muted">
                    <div className="text-sm font-bold" style={{ color: item.color }}>{item.value}</div>
                    <div className="text-[9px] text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: categoryColorFor(entry) }} /></div>
            </button>
          );
        })}
```

- [ ] **Step 7: 타입 컴파일로 회귀 확인**

Run (from `App/frontend`): `npx tsc --noEmit -p .`
Expected: `WorkloadPage.tsx`/`workloadScoreApi.ts` 관련 타입 에러 0건. `anomalyType`(구 단수형)
잔여 참조가 있으면 여기서 컴파일 에러로 드러난다.

- [ ] **Step 8: 수동 확인 (자동화 테스트 없는 화면)**

Run: `cd App/frontend && npm run dev` 로 로컬 개발 서버 실행 후, 브라우저에서 대시보드 →
"팀원별 업무량" 화면(`/dashboard/workload`)에 접속해 다음을 눈으로 확인:
- 배지가 "업무량 편중 의심"/"난이도 편중 의심"/"배정량 불균형" 세 종류로 나오는지
- "저활동 의심" 배지가 더 이상 나오지 않는지
- 여러 축이 동시에 걸린 팀원이 있다면(합성/실 데이터에 따라 없을 수도 있음) 배지가
  여러 개 나열되는지
- AIBox 인사이트 문구가 크래시 없이 나오는지

확인 후 개발 서버 종료.

- [ ] **Step 9: 커밋**

```bash
git add App/frontend/src/dashboard/libs/utils/workloadScoreApi.ts \
        App/frontend/src/dashboard/screen/detail/WorkloadPage.tsx
git commit -m "feat: WorkloadPage를 3축 독립 판정(anomalyTypes) 구조로 갱신, 저활동 의심 죽은 코드 제거"
```

---

### Task 13: 노트북(`workload_score_experiment.ipynb`) 셀 갱신

**Files:**
- Modify: `document_이은주/workload_score_experiment.ipynb` (cell 2, 4, 7, 8, 12, 15, 18, 21, 25, 26 — `anomaly_type`/`difficulty_avg_rel`/`overload_score_0_100` 참조 셀)

**Interfaces:**
- Consumes: `build_features`, `detect_overload_anomalies_auto`, `detect_overload_anomalies`,
  `detect_overload_anomalies_robust` (Task 1~4에서 이미 3축 구조로 갱신 완료)

이 노트북은 자동화 테스트가 아니라 실행해서 눈으로 확인하는 실험 기록물이다. NotebookEdit
도구로 각 셀을 새 필드명에 맞게 고치고, 마지막에 전체 재실행해서 에러 없이 끝까지 도는지
확인한다.

- [ ] **Step 1: 노트북을 열어 셀 구조 확인**

`document_이은주/workload_score_experiment.ipynb`를 Read 도구로 열어, `anomaly_type`,
`difficulty_avg_rel`, `overload_score_0_100`을 참조하는 정확한 셀 인덱스와 각 셀의 현재
소스를 확인한다(Task 작성 시점 기준 대략 2, 4, 7, 8, 12, 15, 18, 21, 25, 26번 셀로 추정되나,
노트북이 수정됐을 수 있으므로 실행 전 반드시 재확인).

- [ ] **Step 2: 피처 엔지니어링 설명 셀(마크다운) 갱신**

`## 2. 피처 엔지니어링` 마크다운 셀의 `difficulty_avg_rel: priority+category 가중치 평균의
팀 평균 대비 비율` 줄을 `difficulty_total_rel: priority+category 가중치 총합(sum)의 팀 평균
대비 비율 - 업무 개수 효과가 반영된다`로 교체.

- [ ] **Step 3: 결과 출력 셀들의 컬럼 리스트 갱신**

`result[["assignee_id", "overload_score_0_100", "is_anomaly", "anomaly_type"]]` 형태로 된
모든 셀(2장 결과 확인, 4장 Isolation Forest/MAD 비교, 5장 균등 분배, 6장 극단 케이스 등)에서
`"anomaly_type"` → `"anomaly_types"`로 컬럼명만 교체. `task_count_total` 등 다른 컬럼명은
그대로 유지.

- [ ] **Step 4: Jira 실데이터 검증 셀(7장 부근) 갱신**

Jira CSV 기반 셀들도 동일하게 `anomaly_type` → `anomaly_types` 컬럼명 교체. 이 셀들이
`result.attrs.get('method_used')`를 출력하는 부분은 변경 불필요(그대로 유지).

- [ ] **Step 5: 노트북 커널 재시작 후 전체 셀 순차 실행**

Jupyter에서 "Restart Kernel and Run All" 실행(또는 `jupyter nbconvert --to notebook --execute`
CLI로 대체 가능). 7장(Supabase 실 DB 연결)은 로컬에 DB 접속 정보가 없으면 실패할 수 있는데,
이건 이번 변경과 무관한 환경 의존 셀이므로 실패해도 이번 작업의 회귀는 아니다 — 그 앞뒤
셀(1~6장, 8장 이후)이 에러 없이 도는지가 확인 기준이다.

Run: `cd document_이은주 && ../.venv/Scripts/jupyter.exe nbconvert --to notebook --execute --inplace workload_score_experiment.ipynb --ExecutePreprocessor.timeout=120`
Expected: 1~6장 셀이 에러 없이 실행 완료. 7~8장(DB 연결 셀)에서 연결 실패로 멈추면, 그 시점까지는
정상이었다는 뜻이므로 이 작업 범위에서는 통과로 간주한다(DB 연결은 로컬 `.env` 설정에 달려
있으며 이번 변경과 무관).

- [ ] **Step 6: 산출물 그래프 재생성 확인**

`output/overload_score_result.png`, `output/overload_score_jira_real_data.png`가 이번 재실행으로
갱신됐는지(파일 수정 시각) 확인.

Run: `ls -la document_이은주/output/*.png`

- [ ] **Step 7: 커밋**

```bash
git add document_이은주/workload_score_experiment.ipynb document_이은주/output/
git commit -m "docs: 워크로드 실험 노트북을 anomaly_types/difficulty_total_rel 3축 구조로 갱신"
```

---

### Task 14: 전체 회귀 테스트 — FastAPI 전체 + Spring 전체 + Frontend 전체

**Files:**
- (수정 없음 — 검증 전용 태스크)

**Interfaces:**
- (해당 없음)

이 태스크는 Task 1~13에서 개별적으로 확인한 것들을 한 번에 다시 돌려서, 태스크 간 상호작용으로
생긴 회귀가 없는지 최종 확인한다.

- [ ] **Step 1: FastAPI 전체 테스트(라우터 제외)**

Run (from `App/backend_fastapi`): `PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests --ignore=tests/ml_workload_score/test_workload_router.py --ignore=tests/contribution_score/test_contribution_router.py -v`
Expected: 전부 통과, 실패 0건 (두 라우터 테스트 파일은 Global Constraints의 사전 존재 redis
ImportError로 이 환경에서 collection 자체가 불가능해서 제외 — Step 2에서 정적 리뷰로 갈음)

- [ ] **Step 2: 라우터 테스트 파일 두 개는 정적 diff 리뷰로 갈음**

`git diff App/backend_fastapi/tests/ml_workload_score/test_workload_router.py
App/backend_fastapi/tests/contribution_score/test_contribution_router.py`를 읽고,
`WorkloadMemberResult(...)`/`ContributionMemberResult` 관련 생성부가 Task 6, 7에서 정의한
필드(`anomaly_types`, `difficulty_score`, `workload_score`, `allocation_score`,
`difficulty_total_rel`)와 정확히 일치하는 키워드 인자를 쓰는지 눈으로 확인한다. 불일치가
있으면 이 Step에서 고치고 다시 diff를 확인한다.

(참고: 이 환경에 `pip install redis==7.4.1`을 실행해 실제로 라우터 테스트를 돌려볼 수도
있으나, 이는 이번 작업과 무관한 사전 환경 문제를 고치는 것이라 Global Constraints에 따라
스코프 밖이다. 만약 사용자가 명시적으로 요청하면 그때 별도로 진행한다.)

- [ ] **Step 3: Spring 전체 테스트**

Run (from `App/backend_spring`): `./gradlew test`
Expected: `BUILD SUCCESSFUL`, 실패 0건

- [ ] **Step 4: Frontend 전체 테스트**

Run (from `App/frontend`): `npx vitest run`
Expected: 전부 통과, 실패 0건

- [ ] **Step 5: Frontend 전체 타입체크**

Run (from `App/frontend`): `npx tsc --noEmit -p .`
Expected: 에러 0건(사전 존재하던 무관한 에러가 있었다면 Task 1 시작 전 baseline과 비교해서
새로 생긴 에러가 없는지만 확인)

- [ ] **Step 6: 남은 구 필드명 잔여 참조 최종 스캔**

Run:
```bash
grep -rn "anomaly_type\b\|anomalyType\b\|difficulty_avg_rel\|difficultyAvgRel" \
  App/backend_fastapi/ml_workload_score App/backend_fastapi/contribution_score \
  App/backend_spring/src/main/java/com/workflowai/dashboard \
  App/backend_spring/src/main/java/com/workflowai/contribution \
  App/frontend/src/contributors App/frontend/src/dashboard \
  --include="*.py" --include="*.java" --include="*.ts" --include="*.tsx" \
  | grep -v "ai_contribution_report"
```
Expected: 결과 없음(`ai_contribution_report`는 스펙 문서에서 명시적으로 스코프 밖으로 뺀
별개 레거시 경로라 제외 패턴에 포함시켰다). 결과가 있다면 그 파일을 열어 놓친 지점을 마저
고친다.

- [ ] **Step 7: 최종 상태를 사용자에게 보고**

Task 1~13에서 커밋한 내역(`git log --oneline` 최근 13~14개)과 Step 1~6의 검증 결과를 요약해
전달한다. 이 Task는 커밋할 파일 변경이 없으므로(검증 전용) git commit 없음 — 대신 Step 2/6에서
수정이 발생했다면 그 변경분만 별도로 커밋한다.
