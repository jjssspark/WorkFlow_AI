from __future__ import annotations

import asyncio
import logging

from langchain_core.runnables import chain

from ml_workload_score.app.services import workload_db as db
from ml_workload_score.app.services.workload_model import (
    build_features,
    detect_overload_anomalies_auto,
    generate_synthetic_tasks,
)
from ml_workload_score.app.schema.workload_schema import (
    WorkloadMemberResult,
    WorkloadScoreData,
)

logger = logging.getLogger(__name__)

# 이상치 판정 3축(compute_axis_results()의 _labels()에 정의된 라벨 그대로) - 트레이스 요약에서
# anomaly_types 리스트를 라벨별 발생 횟수로 집계할 때 사용한다.
_ANOMALY_LABELS = [
    "난이도 편중 의심", "난이도 이상 패턴(방향 불명확)",
    "업무량 편중 의심", "업무량 이상 패턴(방향 불명확)",
    "배정량 불균형", "배정 이상 패턴(방향 불명확)",
]


def _run_build_features(tasks_df):
    """
    build_features()를 LangChain @chain으로 감싸 LangSmith 트레이스에 남긴다.

    체인 함수 자체의 입출력(트레이스에 기록되는 값)은 원본 DataFrame이 아니라 요약 dict로
    제한한다 - 팀원 개인 업무 원본이 그대로 외부(LangSmith)로 전송되지 않게 하기 위함
    (embedding_difficulty.py의 _summarize_* 방어 패턴과 동일한 원칙). 실제 DataFrame은
    파이썬 클로저(holder)로 다음 단계에 직접 전달한다.

    @chain은 모듈 로드 시점이 아니라 이 함수가 호출될 때마다 새로 만든다 - 그래야
    unittest.mock.patch("....build_features")로 이 함수를 갈아끼운 테스트가, patch 시점 이후에
    호출되는 최신 심볼을 참조해 mock이 정상적으로 먹힌다.
    """
    holder: dict = {}

    @chain
    def _build_features_step(trace_input: dict) -> dict:
        holder["features"] = build_features(tasks_df)
        return {"feature_count": len(holder["features"])}

    _build_features_step.invoke({
        "row_count": len(tasks_df),
        "member_count": tasks_df["assignee_id"].nunique() if not tasks_df.empty else 0,
    })
    return holder["features"]


def _run_detect_anomalies(feature_df):
    """detect_overload_anomalies_auto()를 LangChain @chain으로 감싸 트레이스에 남긴다.
    출력 요약은 3축 구조(anomaly_types 리스트) 반영: 라벨별 발생 횟수를 집계한다."""
    holder: dict = {}

    @chain
    def _detect_anomalies_step(trace_input: dict) -> dict:
        holder["result"] = detect_overload_anomalies_auto(feature_df)
        result = holder["result"]
        return {
            "method_used": result.attrs.get("method_used"),
            "member_count": len(result),
            "anomaly_count": int(result["is_anomaly"].sum()) if len(result) else 0,
            "anomaly_type_breakdown": {
                label: sum(label in types for types in result["anomaly_types"])
                for label in _ANOMALY_LABELS
            } if len(result) else {},
        }

    _detect_anomalies_step.invoke({"feature_count": len(feature_df)})
    return holder["result"]


async def get_workload_score(project_id: int, use_synthetic_fallback: bool = False) -> WorkloadScoreData:
    """
    프로젝트의 팀원별 업무 편중(난이도 편중/업무량 편중/배정량 불균형) 점수를 계산한다.

    - project_id: 대상 프로젝트
    - use_synthetic_fallback: 실제 DB 데이터가 없거나 연결 실패 시
      합성 데이터로 데모 응답을 줄지 여부. 기본값 False (운영 기본 동작:
      실패 시 에러를 그대로 올림). 데모/개발 환경에서만 명시적으로 True로 호출할 것.
    """
    try:
        tasks_df = await asyncio.to_thread(db.load_tasks_from_db, project_id)
        source = "db"
    except Exception:
        if not use_synthetic_fallback:
            raise
        logger.warning(
            "project_id=%s: DB 조회 실패, synthetic fallback 데이터로 대체", project_id
        )
        tasks_df = generate_synthetic_tasks(n_members=7)
        source = "synthetic_fallback"

    if tasks_df.empty:
        data = WorkloadScoreData(
            project_id=project_id,
            source=source,
            method="N/A",
            members=[],
            note="배정된 업무가 없어 편중 점수를 계산할 수 없습니다.",
        )
        return data

    features = _run_build_features(tasks_df)
    result = _run_detect_anomalies(features)

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

    return WorkloadScoreData(
        project_id=project_id,
        source=source,
        method=result.attrs.get("method_used", "unknown"),
        members=members,
        team_mean_completion=result.attrs.get("team_mean_completion"),
    )
