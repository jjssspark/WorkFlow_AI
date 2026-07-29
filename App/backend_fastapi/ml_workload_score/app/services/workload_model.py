"""
WorkFlow AI - FS-5 업무 편중 점수 (Workload/Overload Score)
==============================================================
메인: Isolation Forest 비지도 이상치 탐지
옵션: 룰베이스 점수를 pseudo-label 삼은 회귀 (하단 별도 섹션)

실제 서비스 데이터(tasks, activities)가 아직 없어서, 파이프라인 검증용
합성 데이터를 생성해서 사용한다. 나중에 실제 DB 연결 시
`load_tasks_from_db()` 함수만 교체하면 됨.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)

# ============================================================
# 0. 카테고리 / 우선순위 가중치 정의
# ============================================================
# priority: 낮음=1, 중간=2, 높음=3 (난이도 프록시 옵션 A)
PRIORITY_WEIGHT = {"낮음": 1, "중간": 2, "높음": 3}

# category 보정 가중치 (옵션 A의 약점 보완)
# AI/ML, 백엔드처럼 상대적으로 무거운 카테고리는 +0.5, 가벼운 카테고리는 -0.5
CATEGORY_WEIGHT = {
    "AI/ML": 0.5,
    "백엔드": 0.5,
    "데이터": 0.3,
    "DB": 0.3,
    "프론트엔드": 0.0,
    "UX/UI": 0.0,
    "디자인": 0.0,
    "GitHub": 0.0,
    "QA/테스트": 0.0,
    "DevOps": 0.2,
    "보안": 0.2,
    "기획": -0.2,
    "리서치": -0.2,
    "문서": -0.5,
    "발표": -0.5,
    "산출물": -0.3,
    "운영/제출": -0.3,
    "기타": -0.5,
}


## 실 데이터 재검증(2026-07-16)에서 확인된 사실: 실제 tasks.category/priority는 이 딕셔너리의
# 한글 키가 아니라 프런트(App/frontend/src/board/libs/types/task.ts의 CatId/Priority)가 정의한
# 영문 슬러그 그대로 저장돼 있다(예: "ai-ml", "frontend", "HIGH"/"high" 등 대소문자 혼재).
# CATEGORY_WEIGHT/PRIORITY_WEIGHT 자체는 기획 문서 기준 한글 레이블을 유지하고,
# 실측 값 → 한글 키 별칭만 별도로 둬서 difficulty_of()에서만 정규화한다.
CATEGORY_ALIASES = {
    "planning": "기획",
    "research": "리서치",
    "ux-ui": "UX/UI",
    "design": "디자인",
    "frontend": "프론트엔드",
    "backend": "백엔드",
    "ai-ml": "AI/ML",
    "data": "데이터",
    "db": "DB",
    "devops": "DevOps",
    "github": "GitHub",
    "qa": "QA/테스트",
    "security": "보안",
    "docs": "문서",
    "presentation": "발표",
    "deliverable": "산출물",
    "operation": "운영/제출",
    "other": "기타",
}

PRIORITY_ALIASES = {"high": "높음", "medium": "중간", "low": "낮음"}


def normalize_category(category: str) -> str:
    if category in CATEGORY_WEIGHT:
        return category
    return CATEGORY_ALIASES.get(str(category).strip().lower(), category)


def normalize_priority(priority: str) -> str:
    if priority in PRIORITY_WEIGHT:
        return priority
    return PRIORITY_ALIASES.get(str(priority).strip().lower(), priority)


# 실 데이터 재검증(2026-07-16)에서 확인: 실제 tasks.status도 이 모듈이 기대하는 한글값이
# 아니라 프런트(task.ts의 TaskStatus)가 정의한 영문 슬러그로 저장돼 있다. is_done 판정이
# status=="완료" 문자열 비교라 이걸 정규화하지 않으면 실제 완료 업무가 있어도 전부
# completion_rate=0으로 조용히 계산돼버린다(실측에서 실제로 이 버그로 인한 왜곡을 확인함).
STATUS_ALIASES = {"todo": "할 일", "inprogress": "진행 중", "done": "완료", "blocked": "보류/블로커"}
_KNOWN_STATUSES = {"할 일", "진행 중", "완료", "보류/블로커"}


def normalize_status(status: str) -> str:
    if status in _KNOWN_STATUSES:
        return status
    return STATUS_ALIASES.get(str(status).strip().lower(), status)


def difficulty_of(priority: str, category: str) -> float:
    """priority + category 가중치를 합산한 업무 하나의 난이도 프록시 값."""
    base = PRIORITY_WEIGHT.get(normalize_priority(priority), 2)
    adj = CATEGORY_WEIGHT.get(normalize_category(category), 0.0)
    return base + adj


# ============================================================
# 1. 합성 데이터 생성 (실제 DB 연결 전 파이프라인 검증용)
# ============================================================
def generate_synthetic_tasks(n_members: int = 7, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """
    실제 tasks 테이블 스키마를 흉내낸 합성 데이터 생성.
    한 명(assignee_5)은 의도적으로 '과부하' 패턴,
    한 명(assignee_2)은 의도적으로 '저활동' 패턴으로 만들어서
    Isolation Forest가 실제로 두 이상치를 잡아내는지 검증한다.
    """
    rng = np.random.default_rng(seed)
    categories = list(CATEGORY_WEIGHT.keys())
    priorities = ["낮음", "중간", "높음"]
    statuses = ["할 일", "진행 중", "보류/블로커", "완료"]

    rows = []
    task_id = 1

    # 각 팀원의 "성향" 정의 (합성 데이터 생성용 파라미터)
    member_profiles = {}
    for i in range(1, n_members + 1):
        name = f"assignee_{i}"
        if name == "assignee_5":
            # 의도적 과부하: 업무 수 많고, 완료율 낮고, 어려운 카테고리 몰림
            member_profiles[name] = dict(n_tasks=(14, 18), done_prob=0.25,
                                          heavy_category_bias=True, overdue_bias=0.5)
        elif name == "assignee_2":
            # 의도적 저활동: 업무 수 적고, 완료율은 높지만 절대량이 작음
            member_profiles[name] = dict(n_tasks=(2, 4), done_prob=0.8,
                                          heavy_category_bias=False, overdue_bias=0.05)
        else:
            # 평범한 팀원
            member_profiles[name] = dict(n_tasks=(6, 10), done_prob=0.55,
                                          heavy_category_bias=False, overdue_bias=0.15)

    today = pd.Timestamp("2026-07-14")

    for name, prof in member_profiles.items():
        n_tasks = rng.integers(prof["n_tasks"][0], prof["n_tasks"][1] + 1)
        for _ in range(n_tasks):
            if prof["heavy_category_bias"] and rng.random() < 0.6:
                category = rng.choice(["AI/ML", "백엔드", "데이터"])
            else:
                category = rng.choice(categories)

            priority = rng.choice(priorities, p=[0.3, 0.4, 0.3])
            is_done = rng.random() < prof["done_prob"]
            status = "완료" if is_done else rng.choice(["할 일", "진행 중", "보류/블로커"])

            # 마감일: 완료가 아니면 일부는 이미 지난 것으로(overdue) 생성
            if not is_done and rng.random() < prof["overdue_bias"]:
                due_date = today - pd.Timedelta(days=int(rng.integers(1, 10)))
            else:
                due_date = today + pd.Timedelta(days=int(rng.integers(-2, 20)))

            rows.append(dict(
                task_id=task_id,
                project_id=1,
                assignee_id=name,
                category=category,
                priority=priority,
                status=status,
                due_date=due_date,
            ))
            task_id += 1

    return pd.DataFrame(rows)


# ============================================================
# 2. 피처 엔지니어링 (실제 DB 연결 시 이 함수 입력만 실제 tasks df로 교체)
# ============================================================
def build_features(
    tasks_df: pd.DataFrame,
    today: pd.Timestamp = None,
) -> pd.DataFrame:
    """
    팀원별(assignee_id) 피처 테이블 생성.
    - task_count_active: 미완료 업무 수 (과부하 판정용 - "지금 처리 중인 업무가 많은가")
    - task_count_total: 전체 배정 업무 수 (저활동 판정용 - "애초에 배정량 자체가 적은가")
    - completion_rate: 완료 업무 / 전체 업무
    - difficulty_avg: priority+category 가중치 평균
    - overdue_count: 마감 지났는데 미완료
    - upcoming_due_count: 마감 3일 이내 미완료
    모두 '팀 평균 대비 상대값'으로도 같이 계산한다 (과부하/저활동은 상대 개념이므로).

    난이도는 업무의 priority와 category에 정의된 고정 가중치만 사용한다.
    외부 생성형 AI 서비스는 호출하지 않는다.
    """
    if today is None:
        today = pd.Timestamp("2026-07-14")

    df = tasks_df.copy()
    df["is_done"] = df["status"].apply(normalize_status) == "완료"
    df["is_overdue"] = (~df["is_done"]) & (df["due_date"] < today)
    df["is_upcoming"] = (~df["is_done"]) & (df["due_date"] >= today) & \
                         (df["due_date"] <= today + pd.Timedelta(days=3))

    df["difficulty"] = df.apply(lambda r: difficulty_of(r["priority"], r["category"]), axis=1)

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


# ============================================================
# 3. 메인: Isolation Forest 비지도 이상치 탐지
# ============================================================
DIFFICULTY_AXIS_COLUMNS = ["difficulty_total_rel", "overdue_ratio"]
WORKLOAD_AXIS_COLUMNS = ["task_count_active_rel", "completion_rate"]
ALLOCATION_AXIS_COLUMN = "task_count_total_rel"

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

    # 점수는 "팀 내 최댓값" 기준이 아니라 이상치 임계값(z_threshold) 기준으로 스케일링한다.
    # 팀 내 최댓값 기준으로 하면, 아무도 임계값을 넘지 않아도(전원 정상) 그중 상대적으로 가장
    # 튀는 사람이 무조건 100점을 받는 모순이 생긴다(실제로 "정상"인데 100점이 뜨는 문제로 확인됨).
    # 임계값 기준으로 하면 거리==임계값일 때 100점이 되어, 실제 이상치만 100점 근처에 도달한다.
    score = np.minimum(100.0, 100 * modified_z / z_threshold)
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

    # 점수는 "팀 내 최댓값" 기준이 아니라 이상치 임계값(z_threshold) 기준으로 스케일링한다.
    # 팀 내 최댓값 기준으로 하면, 아무도 임계값을 넘지 않아도(전원 정상) 그중 상대적으로 가장
    # 튀는 사람이 무조건 100점을 받는 모순이 생긴다(실제로 "정상"인데 100점이 뜨는 문제로 확인됨).
    # 임계값 기준으로 하면 거리==임계값일 때 100점이 되어, 실제 이상치만 100점 근처에 도달한다.
    score = np.minimum(100.0, 100 * combined_distance / z_threshold)
    return is_anomaly, score


def compute_axis_results(
    feature_df: pd.DataFrame, team_mean_completion: float, z_threshold: float = 3.5
) -> pd.DataFrame:
    """세 축(난이도 편중/업무량 편중/배정량 불균형)을 각각 독립적으로 MAD 판정하고,
    axis별 is_anomaly/score와 통합 anomaly_types/overload_score_0_100을 채운
    DataFrame을 반환한다. 한 사람이 여러 축에서 동시에 이상치일 수 있다.

    z_threshold: 세 축 모두에 공통으로 적용되는 MAD Modified Z-score 임계값. 값이 클수록
    "이상치"로 판정되는 문턱이 높아져 더 극단적인 경우만 잡아낸다(민감도가 낮아짐)."""
    result = feature_df.reset_index(drop=True).copy()

    diff_anomaly, result["difficulty_score"] = _mad_anomaly_multi(
        result[["difficulty_total_rel", "overdue_ratio"]].fillna(0).to_numpy(dtype=float),
        z_threshold=z_threshold,
    )
    workload_anomaly, result["workload_score"] = _mad_anomaly_multi(
        result[["task_count_active_rel", "completion_rate"]].fillna(0).to_numpy(dtype=float),
        z_threshold=z_threshold,
    )
    alloc_anomaly, result["allocation_score"] = _mad_anomaly(
        result["task_count_total_rel"], z_threshold=z_threshold
    )

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


def detect_overload_anomalies_robust(feature_df: pd.DataFrame, z_threshold: float = 3.5) -> pd.DataFrame:
    """
    MAD(Median Absolute Deviation) 기반 3축 독립 이상치 탐지(난이도 편중/업무량 편중/배정량
    불균형). Isolation Forest는 표본 수(팀원 수)가 적으면 트리 분할이 불안정해져서 극단값을
    놓치는 경우가 실제로 발생함(5명 팀 검증에서 확인됨). 캡스톤 팀 규모(5~9명)처럼 표본이
    작을 때는 이 방식이 더 안정적.

    z_threshold: Iglewicz & Hoaglin(1993) 권장 기준값 3.5. compute_axis_results()로 그대로
    전달되어 세 축(난이도 편중/업무량 편중/배정량 불균형) 판정에 공통으로 적용된다.
    """
    team_mean_completion = feature_df["completion_rate"].mean()
    result = compute_axis_results(feature_df, team_mean_completion, z_threshold=z_threshold)
    result = result.sort_values("overload_score_0_100", ascending=False)
    # anomaly_types 판정에 실제로 쓰인 팀 평균 완료율을 함께 실어 보낸다 - 프론트가
    # 팀 평균보다 높음/낮음 문구를 이 실측값과 함께 보여줄 수 있도록.
    result.attrs["team_mean_completion"] = float(team_mean_completion)
    return result


def detect_overload_anomalies_auto(feature_df: pd.DataFrame, small_team_threshold: int = 15) -> pd.DataFrame:
    """
    팀 규모에 따라 자동으로 방법을 선택.
    - 팀원 수 < 15: MAD 기반 (표본 적을 때 안정적)
    - 팀원 수 >= 15: Isolation Forest (표본 충분할 때 비선형 패턴 포착 가능)
    실제 캡스톤 팀(5~9명) 기준으로는 항상 MAD 경로를 타게 됨.
    """
    n = len(feature_df)
    if n < small_team_threshold:
        method = "MAD (소규모 팀)"
        result = detect_overload_anomalies_robust(feature_df)
    else:
        method = "Isolation Forest (대규모)"
        result = detect_overload_anomalies(feature_df)
    result.attrs["method_used"] = method
    return result


def detect_overload_anomalies(
    feature_df: pd.DataFrame, contamination: float = None, z_threshold: float = 3.5
) -> pd.DataFrame:
    """
    팀 규모가 큰 경우(15명 이상)에도 MAD 경로(detect_overload_anomalies_robust)와 동일한
    3축 독립 판정 구조(anomaly_types, difficulty_score/workload_score/allocation_score)를
    유지한다. Isolation Forest(비지도 이상치 모델)는 참고용 전체 이상치 스코어만 계산하고
    (extra_isolation_forest_score 컬럼), 실제 응답에 쓰이는 anomaly_types/overload_score_0_100은
    compute_axis_results()의 MAD 기반 3축 결과를 그대로 사용한다 - 두 개의 서로 다른 이상치
    개념(트리 기반 vs MAD 기반)이 동시에 노출되면 프론트/심사자가 혼란스러우므로, 응답
    구조를 하나로 통일하는 쪽을 택했다.

    contamination: 참고용 Isolation Forest 스코어 계산에만 쓰인다(응답 구조에는 영향 없음).
    z_threshold: compute_axis_results()의 MAD 판정에 그대로 전달된다. detect_overload_anomalies_robust()와
    동일한 파라미터를 노출해 두 경로(소규모 MAD / 대규모 Isolation Forest) 간 z_threshold
    커스터마이징 방식을 일관되게 유지한다.
    """
    n = len(feature_df)
    if contamination is None:
        if n < 3:
            contamination = 0.49
        else:
            contamination = min(0.4, max(1.0 / n, 0.1))

    all_axis_columns = DIFFICULTY_AXIS_COLUMNS + WORKLOAD_AXIS_COLUMNS + [ALLOCATION_AXIS_COLUMN]
    X = feature_df[all_axis_columns].fillna(0).values
    X_scaled = StandardScaler().fit_transform(X)

    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=RANDOM_SEED,
    )
    model.fit(X_scaled)
    raw_score = model.decision_function(X_scaled)

    team_mean_completion = feature_df["completion_rate"].mean()
    result = compute_axis_results(feature_df, team_mean_completion, z_threshold=z_threshold)
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


# ============================================================
# 4. (옵션) Self-labeling 회귀 - 룰베이스 점수를 pseudo-label로 학습
# ============================================================
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


# ============================================================
# 5. 실행
# ============================================================
