# FS-5 워크로드 스코어 — 업무 편중도 3축 독립 판정 체계 설계

작성일: 2026-07-28
작성자: 이은주 (FS-5 ML/AI 모델링)
관련: `App/backend_fastapi/ml_workload_score/`, `App/backend_fastapi/contribution_score/`,
`App/backend_spring/.../dashboard/DTO/WorkloadScoreMemberDto.java`,
`App/backend_spring/.../contribution/ContributionMemberScoreDto.java`,
`App/frontend/src/contributors/`

## 배경 / 문제

기여도 분석 화면(심사자 뷰)에서 "박지수는 To-Do 12개(전부 완료), 홍길동은 6개인데 왜 박지수만
'배정량 불균형'으로 뜨는가"라는 의문에서 출발했다. 원인을 추적한 결과, 기존
`workload_model.py`의 이상치 판정 로직이 다음과 같이 동작하고 있었다:

- 4개 피처(`task_count_active_rel`(진행중 업무 비율), `completion_rate`(완료율),
  `difficulty_avg_rel`(건당 평균 난이도 비율), `overdue_ratio`(연체 비율))를 **하나의
  MAD(Median Absolute Deviation) 거리로 합산**해 단일 `is_anomaly`/`anomaly_type`을 산출.
- 박지수(12/12 완료, active=0)는 `task_count_active_rel`이 극단값(0)이라 이상치로 잡혔고,
  `completion_rate`(100%)가 팀 평균보다 높아 "배정량 불균형"으로 태깅됨.
- 홍길동(2/6 완료, active=4)은 active 값이 다른 팀원(14~21)보다는 낮지만 0처럼 극단적이지
  않아 종합 MAD 거리가 임계값을 못 넘겨 "정상"으로 판정됨.

즉 이 지표는 사실상 "진행중 업무 개수가 팀 평균 대비 얼마나 튀는가"로 판정되고 있었고,
팀이 원래 의도했던 "누구에게 어려운 일이 많이 몰렸는가"는 `difficulty_avg_rel`(건당 평균)에만
갇혀 있어 **업무 개수 효과가 전혀 반영되지 않았다**(어려운 일 3건과 20건이 평균 난이도가
같으면 동일하게 취급됨).

## 접근

하나의 합산 이상치 판정을 **세 개의 독립된 축**으로 분리한다. 각 축은 자체 MAD z-score로
이상치를 판정하며, 한 사람이 동시에 여러 축에서 이상치일 수 있다(예: 배정량은 팀 평균보다
적지만 그중 어려운 일 비중이 높아 난이도는 몰린 경우).

| 축 | 판정 피처 | 방향 라벨 | 방향 불명확 라벨 | 대표점수 가중치 |
|---|---|---|---|---|
| **난이도 몰림** (신규, 메인 목적) | `difficulty_total_rel`(신규) + `overdue_ratio` | "난이도 몰림 의심" | "난이도 이상 패턴(방향 불명확)" | **0.6** |
| **업무량 몰림** (구 "과부하 의심" 개명, 로직 동일) | `task_count_active_rel` + `completion_rate` | "업무량 몰림 의심" | "업무량 이상 패턴(방향 불명확)" | **0.2** |
| **배정량 불균형** (기존 유지) | `task_count_total_rel`(단일 피처) | "배정량 불균형" | "배정 이상 패턴(방향 불명확)" | **0.2** |

### 왜 세 축을 분리하는가

- `task_count_active_rel`과 `task_count_total_rel`은 `active = total - done`이라 완료율
  편차가 크지 않으면 거의 같이 움직인다. 두 값을 하나의 합산 거리에 섞으면 "업무량이 적다"는
  하나의 사실이 이중으로 반영돼 대표 점수가 여전히 업무량 신호에 편향된다 — 축을 분리하고
  가중치로 명시적으로 통제하는 편이 낫다.
- "배정량 불균형"과 "업무량 몰림(구 과부하 의심)"은 서로 다른 질문("애초에 적게 받았나" vs
  "지금 진행중인 게 많고 못 끝내고 있나")이므로 독립 축으로 유지한다.
- "난이도 몰림"은 팀이 원래 원했던 지표이므로 가중치를 가장 높게(0.6) 둔다.

## `difficulty_total_rel` 신규 피처

기존 `difficulty_avg_rel`(assignee별 `difficulty_of(priority, category)`의 **평균**, 팀 평균
대비 비율)을 **합산(sum)** 기준으로 바꾼다:

```python
grouped["difficulty_total"] = df.groupby("assignee_id")["difficulty"].sum()
# difficulty_total_rel = difficulty_total / team_mean(difficulty_total)
```

`difficulty_of()`, `CATEGORY_WEIGHT`, `PRIORITY_WEIGHT`, `normalize_*()` 등 난이도 계산
자체는 변경하지 않는다 — 집계 방식(mean → sum)만 바뀐다.

## `tag_direction()` → 3축 독립 판정 함수로 재작성

```python
def _mad_anomaly(series: pd.Series, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]:
    """1개 피처 기준 MAD z-score 이상치 판정. (is_anomaly, score_0_100) 반환."""
    ...

def _mad_anomaly_multi(X: np.ndarray, z_threshold: float = 3.5) -> tuple[np.ndarray, np.ndarray]:
    """N개 피처 기준 MAD z-score 유클리드 거리 이상치 판정 (기존 로직과 동일한 방식,
    피처 집합만 축마다 다르게 적용)."""
    ...

def compute_axis_results(feature_df: pd.DataFrame, team_mean_completion: float) -> pd.DataFrame:
    """세 축을 각각 독립적으로 판정하고 axis별 is_anomaly/score/label을 채운 DataFrame 반환."""
    result = feature_df.copy()

    # 축 1: 난이도 몰림 (difficulty_total_rel + overdue_ratio)
    diff_anomaly, result["difficulty_score"] = _mad_anomaly_multi(
        feature_df[["difficulty_total_rel", "overdue_ratio"]].fillna(0).values
    )
    # 축 2: 업무량 몰림 (task_count_active_rel + completion_rate)
    workload_anomaly, result["workload_score"] = _mad_anomaly_multi(
        feature_df[["task_count_active_rel", "completion_rate"]].fillna(0).values
    )
    # 축 3: 배정량 불균형 (task_count_total_rel 단일 피처)
    alloc_anomaly, result["allocation_score"] = _mad_anomaly(feature_df["task_count_total_rel"])

    def _labels(row) -> list[str]:
        labels = []
        if diff_anomaly[row.name]:
            labels.append("난이도 몰림 의심" if row["difficulty_total_rel"] > 1.0
                           else "난이도 이상 패턴(방향 불명확)")
        if workload_anomaly[row.name]:
            if row["task_count_active_rel"] > 1.0 and row["completion_rate"] < team_mean_completion:
                labels.append("업무량 몰림 의심")
            else:
                labels.append("업무량 이상 패턴(방향 불명확)")
        if alloc_anomaly[row.name]:
            if row["task_count_total_rel"] < 1.0 and row["completion_rate"] > team_mean_completion:
                labels.append("배정량 불균형")
            else:
                labels.append("배정 이상 패턴(방향 불명확)")
        return labels

    result["anomaly_types"] = result.apply(_labels, axis=1)
    result["is_anomaly"] = result["anomaly_types"].apply(lambda t: len(t) > 0)
    result["overload_score_0_100"] = (
        result["difficulty_score"] * 0.6
        + result["workload_score"] * 0.2
        + result["allocation_score"] * 0.2
    )
    return result
```

`detect_overload_anomalies_robust()`(MAD 경로)와 `detect_overload_anomalies()`(Isolation
Forest 경로) 둘 다 이 `compute_axis_results()`를 호출하도록 통일한다 — **Isolation Forest
경로(팀원 15명 이상)도 같은 3축 구조로 전환**해 `detect_overload_anomalies_auto()`가 어느
경로를 타든 응답 구조(`anomaly_types`, 축별 점수)가 동일하게 유지되도록 한다. Isolation
Forest 자체(비지도 이상치 모델)는 각 축의 피처 부분집합에 대해 독립적으로 적용한다.

## FEATURE_COLUMNS / 상수 변경

```python
DIFFICULTY_AXIS_COLUMNS = ["difficulty_total_rel", "overdue_ratio"]
WORKLOAD_AXIS_COLUMNS = ["task_count_active_rel", "completion_rate"]
ALLOCATION_AXIS_COLUMN = "task_count_total_rel"

AXIS_WEIGHTS = {"difficulty": 0.6, "workload": 0.2, "allocation": 0.2}
```

기존 `FEATURE_COLUMNS`(4개 통합 리스트)는 삭제한다 — 더 이상 단일 목적으로 쓰이지 않는다.

## 데드코드 정리 (`rule_based_score` / `optional_regression_baseline`)

어디서도 호출되지 않는 실험용 함수지만, 문서 가치를 위해 새 축 가중치를 반영해 공식을
재작성한다:

```python
def rule_based_score(feature_df: pd.DataFrame,
                      w_difficulty=0.6, w_workload=0.2, w_allocation=0.2) -> pd.Series:
    """3축 가중치와 동일한 룰베이스 공식(기존 4피처 통합 공식을 3축 체계로 재작성):
    overload = w_difficulty*(difficulty_total_rel) + w_workload*(active_rel*(1-completion_rate))
               + w_allocation*(1 - min(total_rel, 1.0))
    """
    return (
        w_difficulty * feature_df["difficulty_total_rel"]
        + w_workload * feature_df["task_count_active_rel"] * (1 - feature_df["completion_rate"])
        + w_allocation * (1 - feature_df["task_count_total_rel"].clip(upper=1.0))
    )
```

`optional_regression_baseline()`은 `FEATURE_COLUMNS` 참조를
`DIFFICULTY_AXIS_COLUMNS + WORKLOAD_AXIS_COLUMNS + [ALLOCATION_AXIS_COLUMN]`으로 교체.

## 스키마 변경

### `workload_schema.py` — `WorkloadMemberResult`

```python
class WorkloadMemberResult(BaseModel):
    assignee_id: str
    task_count_total: int
    completion_rate: float
    overload_score: float          # 대표 점수(가중평균 0.6/0.2/0.2). 필드명 유지(하위 호환)
    is_anomaly: bool                # 세 축 중 하나라도 True
    anomaly_types: list[str]        # 변경: str -> list[str]. 정상이면 []
    difficulty_score: float         # 신규: 난이도 몰림 축 점수 0~100
    workload_score: float           # 신규: 업무량 몰림 축 점수 0~100
    allocation_score: float         # 신규: 배정량 불균형 축 점수 0~100
    task_count_active_rel: float
    task_count_total_rel: float
    difficulty_total_rel: float     # 변경: difficulty_avg_rel -> difficulty_total_rel
    overdue_count: int
```

### `contribution_schema.py` — `ContributionMemberResult`

동일 패턴 반영(`anomaly_type` → `anomaly_types`, `difficulty_avg_rel` → `difficulty_total_rel`,
`difficulty_score`/`workload_score`/`allocation_score` 추가).

`contribution_service.py`의 `workload_component_of()`:

```python
def workload_component_of(member: WorkloadMemberResult) -> float:
    if "배정량 불균형" in member.anomaly_types:
        return max(0.0, 100.0 - member.overload_score)
    return 100.0
```

(판정 조건이 `== "배정량 불균형"` → `in member.anomaly_types`로 바뀔 뿐, 다른 라벨이 함께
있어도 "배정량 불균형"이 포함되면 동일하게 감점 — 기존 의미 유지.)

## Spring DTO 변경

- `App/backend_spring/.../dashboard/DTO/WorkloadScoreMemberDto.java`:
  `String anomaly_type` → `List<String> anomaly_types`,
  `Double difficulty_avg_rel` → `Double difficulty_total_rel`,
  `Double difficulty_score`, `Double workload_score`, `Double allocation_score` 필드 추가.
- `App/backend_spring/.../contribution/ContributionMemberScoreDto.java`: 동일 패턴.
- 두 DTO 모두 순수 필드 매핑(record)이라 로직 변경 없음 — 컴파일 타임에 필드 불일치가
  드러나므로 누락 위험은 낮다.

## Frontend 변경

- `App/frontend/src/contributors/libs/utils/contributorsApi.ts`의
  `ContributionMemberScoreDto` 타입: `anomalyType: string` → `anomalyTypes: string[]`,
  `difficultyAvgRel` → `difficultyTotalRel`, `difficultyScore`/`workloadScore`/`allocationScore`
  추가. 매핑부(`m.anomaly_type` 등)도 스네이크→카멜 변환에 맞춰 갱신.
- `App/frontend/src/contributors/components/MemberDrilldownPanel.tsx`:
  - `ANOMALY_BADGE_STYLE`에 신규 라벨(`"난이도 몰림 의심"`, `"업무량 몰림 의심"`, 각 축의
    "~이상 패턴(방향 불명확)" 3종) 스타일 추가.
  - 단일 배지 렌더링(`ANOMALY_BADGE_STYLE[anomalyType]`) → `anomalyTypes.map()`으로 다중
    배지 렌더링.
  - `buildWorkloadEvidenceSentences()`: 현재 `if/else if` 단일 분기 구조를 `anomalyTypes`
    배열을 순회하며 각 라벨에 해당하는 문구를 이어붙이는 구조로 변경. 빈 배열이면 기존처럼
    "특별한 편중이 없습니다" 문구 유지.
- **목록 테이블 "업무 편중도" 컬럼**(`ContributorsView.tsx`)에서 다중 배지를 어떻게 배치할지
  (배지 여러 개 나열 vs 대표 라벨 1~2개 + "+N" 축약 등)는 **구현 단계에서 실제 화면을 보며
  결정**한다 — 이 설계 문서의 스코프 밖.

## 노트북 (`document_이은주/workload_score_experiment.ipynb`)

새 필드명(`anomaly_types`, `difficulty_total_rel`, `difficulty_score`/`workload_score`/
`allocation_score`)과 3축 구조에 맞춰 관련 셀(2, 7, 8, 12, 15, 18, 25, 26장 등 `anomaly_type`/
`difficulty_avg_rel`/`overload_score_0_100` 참조 셀)을 갱신한다. 실행해서 정상 동작하는 것까지
확인한다.

`01-contribution-weight-experiment.ipynb`는 `workload_component`/`task_component`/
`meeting_component`만 참조하고 이번에 바뀌는 필드를 쓰지 않으므로 스코프 밖.

## 테스트 영향

### FastAPI
- `test_workload_model_anomaly_direction.py`: `anomaly_type == "배정량 불균형"` 단언 →
  `"배정량 불균형" in anomaly_types`로 수정. 새 시나리오(난이도 몰림 단독/복합 라벨) 케이스
  추가.
- `test_workload_model_team_mean.py`: `team_mean_completion` attrs 전달은 그대로 유지되는지
  회귀 확인(로직 변경 없음, 영향 적음).
- `test_workload_service.py`: mock DataFrame의 컬럼명(`anomaly_type`→`anomaly_types`,
  `difficulty_avg_rel`→`difficulty_total_rel`) 및 검증 갱신.
- `test_workload_router.py`: 응답 스키마 변경에 따른 통합 테스트 갱신.
- `App/backend_fastapi/tests/contribution_score/test_contribution_service.py`,
  `test_contribution_router.py`: `_member()` 헬퍼와 검증부를 `anomaly_types` 리스트 기준으로
  갱신.

### Spring
- `DashboardServiceTest.java`, `DashboardControllerTest.java`: `anomaly_type()` 단일 접근 →
  `anomaly_types()` 리스트 접근으로 갱신.
- `ContributionScoreControllerTest.java`: 동일 패턴.

### Frontend
- `ContributorsView.test.tsx`, `MemberDrilldownPanel.test.tsx`,
  `contributorsApi.test.ts`: mock 데이터/단언을 `anomalyTypes` 배열 기준으로 갱신.

## 스코프 밖

- 목록 테이블의 다중 배지 UI 구체 레이아웃(구현 단계에서 결정).
- `01-contribution-weight-experiment.ipynb`(영향 없음).
- 새 가중치 실험/재검증(0.6/0.2/0.2는 사용자 결정값 — 별도 데이터 기반 재조정은 이번 스코프
  아님).
