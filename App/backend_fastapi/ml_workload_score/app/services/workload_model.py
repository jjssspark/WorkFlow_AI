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
from langsmith import traceable
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
def _summarize_build_features_inputs(inputs: dict) -> dict:
    """LangSmith 트레이스에 tasks_df 전체 대신 행 수/컬럼명 요약만 기록한다."""
    tasks_df = inputs.get("tasks_df")
    embedding_adjustments = inputs.get("embedding_adjustments")
    return {
        "tasks_df_rows": len(tasks_df),
        "tasks_df_columns": list(tasks_df.columns),
        "embedding_adjustments_count": len(embedding_adjustments) if embedding_adjustments else 0,
    }


def _summarize_build_features_outputs(outputs: pd.DataFrame) -> dict:
    """LangSmith 트레이스에 feature_df 전체 대신 행 수/컬럼명 요약만 기록한다."""
    return {
        "feature_df_rows": len(outputs),
        "feature_df_columns": list(outputs.columns),
    }


@traceable(
    run_type="tool",
    name="build_features",
    process_inputs=_summarize_build_features_inputs,
    process_outputs=_summarize_build_features_outputs,
)
def build_features(
    tasks_df: pd.DataFrame,
    today: pd.Timestamp = None,
    embedding_adjustments: dict[int, float] | None = None,
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

    embedding_adjustments: {task_id: 보정치} — embedding_difficulty.compute_embedding_adjustments()의
    반환값을 그대로 넘긴다. None이면(기본값) 기존 동작과 완전히 동일.
    """
    if today is None:
        today = pd.Timestamp("2026-07-14")

    df = tasks_df.copy()
    df["is_done"] = df["status"].apply(normalize_status) == "완료"
    df["is_overdue"] = (~df["is_done"]) & (df["due_date"] < today)
    df["is_upcoming"] = (~df["is_done"]) & (df["due_date"] >= today) & \
                         (df["due_date"] <= today + pd.Timedelta(days=3))

    if embedding_adjustments:
        df["difficulty"] = df.apply(
            lambda r: difficulty_of(r["priority"], r["category"])
            + embedding_adjustments.get(r["task_id"], 0.0),
            axis=1,
        )
    else:
        df["difficulty"] = df.apply(lambda r: difficulty_of(r["priority"], r["category"]), axis=1)

    grouped = df.groupby("assignee_id").agg(
        task_count_total=("task_id", "count"),
        task_count_active=("is_done", lambda s: (~s).sum()),
        task_count_done=("is_done", "sum"),
        difficulty_avg=("difficulty", "mean"),
        overdue_count=("is_overdue", "sum"),
        upcoming_due_count=("is_upcoming", "sum"),
    ).reset_index()

    grouped["completion_rate"] = grouped["task_count_done"] / grouped["task_count_total"]
    grouped["overdue_ratio"] = grouped["overdue_count"] / grouped["task_count_total"]

    # 팀 평균 대비 상대값 (정규화) - 과부하는 "팀 평균보다 얼마나 많은가"가 핵심.
    # task_count_total_rel(전체 배정량)은 "배정량 불균형" 판정 전용 근거다: task_count_active
    # (미완료 개수)만으로 판단하면, 배정된 업무를 전부 끝낸 사람도 진행중 업무가 0이 되어
    # "애초에 배정량 자체가 적은 사람"과 "일을 다 끝낸 사람"이 구분되지 않는 문제가 있었다
    # (실사용 중 발견: 12/12 완료한 팀원이 "저활동 의심"으로 오판됨 - 완료 여부와 무관하게
    # 순수히 배정량만으로 판단하도록 라벨/근거를 분리했다).
    for col in ["task_count_active", "task_count_total", "difficulty_avg"]:
        team_avg = grouped[col].mean()
        grouped[f"{col}_rel"] = grouped[col] / team_avg if team_avg > 0 else 0

    return grouped


# ============================================================
# 3. 메인: Isolation Forest 비지도 이상치 탐지
# ============================================================
FEATURE_COLUMNS = [
    "task_count_active_rel",
    "completion_rate",
    "difficulty_avg_rel",
    "overdue_ratio",
]


def detect_overload_anomalies_robust(feature_df: pd.DataFrame, z_threshold: float = 3.5) -> pd.DataFrame:
    """
    MAD(Median Absolute Deviation) 기반 Modified Z-score 이상치 탐지.
    Isolation Forest는 표본 수(팀원 수)가 적으면 트리 분할이 불안정해져서
    극단값을 놓치는 경우가 실제로 발생함 (5명 팀 검증에서 확인됨).
    캡스톤 팀 규모(5~9명)처럼 표본이 작을 때는 이 방식이 더 안정적.

    z_threshold: Iglewicz & Hoaglin(1993) 권장 기준값 3.5
    """
    X = feature_df[FEATURE_COLUMNS].fillna(0).values
    median = np.median(X, axis=0)
    mad = np.median(np.abs(X - median), axis=0)

    # MAD가 0이면(값들이 중앙값에 몰려있으면) 아주 작은 차이도 z-score가 폭발함.
    # → 표준편차로 폴백. 표준편차마저 0(완전히 동일한 값)이면 그 피처는 변별력이 없으므로
    #   판단에서 제외(가중치 0) 처리.
    std = X.std(axis=0)
    denom = np.where(mad > 0, mad / 0.6745, np.where(std > 0, std, np.inf))

    modified_z = (X - median) / denom
    # 여러 피처의 이상치 정도를 하나의 거리값으로 합산 (Euclidean of z-scores)
    combined_distance = np.sqrt((modified_z ** 2).sum(axis=1))

    result = feature_df.copy()
    result["anomaly_score_raw"] = combined_distance
    result["is_anomaly"] = combined_distance > z_threshold

    max_d = combined_distance.max()
    result["overload_score_0_100"] = 100 * combined_distance / max_d if max_d > 0 else 0.0

    team_mean_completion = feature_df["completion_rate"].mean()

    def tag_direction(row):
        if not row["is_anomaly"]:
            return "정상"
        if row["task_count_active_rel"] > 1.0 and row["completion_rate"] < team_mean_completion:
            return "과부하 의심"
        # "배정량 불균형"은 "진행중 업무가 적음"(task_count_active_rel)이 아니라 "애초에
        # 배정받은 업무 자체가 팀 평균보다 적음"(task_count_total_rel)으로 판단한다. 전자로
        # 판단하면 배정된 일을 전부 끝낸 사람(진행중 업무=0)도 무조건 걸리는 문제가 있었다.
        # "저활동 의심"이 아니라 이 라벨을 쓰는 이유: 배정량이 팀 평균보다 적다는 사실 자체는
        # 참이더라도, 그 사람이 태만하다는 뜻은 아니다(완료율이 높으면 오히려 반대 신호일 수
        # 있음) - 판단은 사람(심사자)에게 맡기고 관찰된 사실만 중립적으로 전달한다.
        elif row["task_count_total_rel"] < 1.0 and row["completion_rate"] > team_mean_completion:
            return "배정량 불균형"
        return "이상 패턴(방향 불명확)"

    result["anomaly_type"] = result.apply(tag_direction, axis=1)
    result = result.sort_values("overload_score_0_100", ascending=False)
    # anomaly_type 판정에 실제로 쓰인 팀 평균 완료율을 함께 실어 보낸다 - 프론트가
    # 팀 평균보다 높음/낮음 문구를 이 실측값과 함께 보여줄 수 있도록.
    result.attrs["team_mean_completion"] = float(team_mean_completion)
    return result


def _summarize_detect_overload_inputs(inputs: dict) -> dict:
    """LangSmith 트레이스에 feature_df 전체 대신 행 수/임계값 요약만 기록한다."""
    feature_df = inputs.get("feature_df")
    return {
        "feature_df_rows": len(feature_df),
        "small_team_threshold": inputs.get("small_team_threshold"),
    }


def _summarize_detect_overload_outputs(outputs: pd.DataFrame) -> dict:
    """LangSmith 트레이스에 result df 전체 대신 이상치 개수/상위 점수 요약만 기록한다."""
    top_score = outputs["overload_score_0_100"].max() if len(outputs) > 0 else None
    return {
        "result_rows": len(outputs),
        "anomaly_count": int(outputs["is_anomaly"].sum()),
        "top_score": float(top_score) if top_score is not None else None,
        "method_used": outputs.attrs.get("method_used"),
    }


@traceable(
    run_type="tool",
    name="detect_overload_anomalies_auto",
    process_inputs=_summarize_detect_overload_inputs,
    process_outputs=_summarize_detect_overload_outputs,
)
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


def detect_overload_anomalies(feature_df: pd.DataFrame, contamination: float = None) -> pd.DataFrame:
    """
    Isolation Forest로 팀 내 '통계적 이상치'(과부하 또는 저활동)를 탐지.
    contamination: 전체 팀원 중 이상치로 볼 비율. None이면 팀 규모 기반 자동 조정.
      - sklearn은 (0, 0.5] 범위만 허용하므로 소규모 팀에서 값이 너무 작으면
        이상치가 0명으로 잡히는 문제가 생길 수 있어 최소 1명은 잡히도록 하한을 둠.
    """
    n = len(feature_df)
    if contamination is None:
        if n < 3:
            contamination = 0.49  # 팀원 2명 이하면 사실상 이상치 탐지 의미 적음, 경고만
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

    # decision_function: 클수록 정상, 작을수록(음수일수록) 이상치
    raw_score = model.decision_function(X_scaled)
    is_anomaly = model.predict(X_scaled) == -1  # -1이면 이상치, 1이면 정상

    result = feature_df.copy()
    result["anomaly_score_raw"] = raw_score
    result["is_anomaly"] = is_anomaly

    # 발표/화면 표시용으로 0~100 과부하 점수로 변환 (점수 높을수록 이상치에 가까움)
    # raw_score가 낮을수록(음수) 이상치이므로 부호 반전 후 0~100 스케일링
    inverted = -raw_score
    min_v, max_v = inverted.min(), inverted.max()
    if max_v > min_v:
        result["overload_score_0_100"] = 100 * (inverted - min_v) / (max_v - min_v)
    else:
        result["overload_score_0_100"] = 50.0

    # 방향성 태깅: completion_rate와 task_count로 '과부하형' vs '저활동형' 구분
    team_mean_completion = feature_df["completion_rate"].mean()

    def tag_direction(row):
        if not row["is_anomaly"]:
            return "정상"
        if row["task_count_active_rel"] > 1.0 and row["completion_rate"] < team_mean_completion:
            return "과부하 의심"
        # "배정량 불균형"은 "진행중 업무가 적음"(task_count_active_rel)이 아니라 "애초에
        # 배정받은 업무 자체가 팀 평균보다 적음"(task_count_total_rel)으로 판단한다. 전자로
        # 판단하면 배정된 일을 전부 끝낸 사람(진행중 업무=0)도 무조건 걸리는 문제가 있었다.
        # "저활동 의심"이 아니라 이 라벨을 쓰는 이유: 배정량이 팀 평균보다 적다는 사실 자체는
        # 참이더라도, 그 사람이 태만하다는 뜻은 아니다(완료율이 높으면 오히려 반대 신호일 수
        # 있음) - 판단은 사람(심사자)에게 맡기고 관찰된 사실만 중립적으로 전달한다.
        elif row["task_count_total_rel"] < 1.0 and row["completion_rate"] > team_mean_completion:
            return "배정량 불균형"
        return "이상 패턴(방향 불명확)"

    result["anomaly_type"] = result.apply(tag_direction, axis=1)

    result = result.sort_values("overload_score_0_100", ascending=False)
    # MAD 경로와 동일하게, anomaly_type 판정에 쓰인 팀 평균 완료율을 함께 실어 보낸다.
    result.attrs["team_mean_completion"] = float(team_mean_completion)
    return result


# ============================================================
# 4. (옵션) Self-labeling 회귀 - 룰베이스 점수를 pseudo-label로 학습
# ============================================================
def rule_based_score(feature_df: pd.DataFrame,
                      w1=0.4, w2=0.3, w3=0.2, w4=0.1) -> pd.Series:
    """
    이전에 설계한 룰베이스 공식:
    overload = w1*(active_rel) + w2*(1-completion_rate) + w3*(difficulty_rel) + w4*(overdue_ratio)
    이 값을 회귀 모델의 pseudo-label(정답 대용)으로 사용할 수 있음.
    """
    return (
        w1 * feature_df["task_count_active_rel"]
        + w2 * (1 - feature_df["completion_rate"])
        + w3 * feature_df["difficulty_avg_rel"]
        + w4 * feature_df["overdue_ratio"]
    )


def optional_regression_baseline(feature_df: pd.DataFrame):
    """
    옵션: 룰베이스 점수를 pseudo-label 삼아 선형회귀 baseline 학습.
    실제 라벨이 아니므로 '룰을 재현하는 모델'이라는 한계를 명시하고 사용할 것.
    """
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import r2_score

    y_pseudo = rule_based_score(feature_df)
    X = feature_df[FEATURE_COLUMNS].fillna(0).values

    reg = LinearRegression()
    reg.fit(X, y_pseudo)
    pred = reg.predict(X)

    print("\n[옵션] Self-labeling 회귀 baseline")
    print(f"  R^2 (룰 재현도): {r2_score(y_pseudo, pred):.4f}")
    print(f"  계수: {dict(zip(FEATURE_COLUMNS, reg.coef_.round(3)))}")
    return reg


# ============================================================
# 5. 실행
# ============================================================
