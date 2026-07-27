from __future__ import annotations

import asyncio
import logging

from langsmith import traceable

from ml_workload_score.app.services import workload_db as db
from ml_workload_score.app.services.embedding_difficulty import compute_embedding_adjustments
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


def _summarize_get_workload_score_outputs(outputs: WorkloadScoreData) -> dict:
    """LangSmith 트레이스에 팀원별 개인 데이터(WorkloadMemberResult) 전체 대신
    프로젝트 단위 요약 통계만 기록한다."""
    return {
        "project_id": outputs.project_id,
        "source": outputs.source,
        "method": outputs.method,
        "member_count": len(outputs.members),
        "anomaly_count": sum(1 for m in outputs.members if m.is_anomaly),
        "note": outputs.note,
    }


@traceable(
    run_type="chain",
    name="get_workload_score",
    process_outputs=_summarize_get_workload_score_outputs,
)
async def get_workload_score(project_id: int, use_synthetic_fallback: bool = False) -> WorkloadScoreData:
    """
    프로젝트의 팀원별 업무 편중(과부하/저활동) 점수를 계산한다.

    - project_id: 대상 프로젝트
    - use_synthetic_fallback: 실제 DB 데이터가 없거나 연결 실패 시
      합성 데이터로 데모 응답을 줄지 여부. 기본값 False (운영 기본 동작:
      실패 시 에러를 그대로 올림). 데모/개발 환경에서만 명시적으로 True로 호출할 것.
    """
    embedding_adjustments: dict[int, float] = {}
    try:
        tasks_df = await asyncio.to_thread(db.load_tasks_from_db, project_id)
        source = "db"
        if not tasks_df.empty:
            embedding_adjustments = await compute_embedding_adjustments(
                tasks_df["task_id"].tolist(), project_id
            )
    except Exception:
        if not use_synthetic_fallback:
            raise
        logger.warning(
            "project_id=%s: DB 조회 실패, synthetic fallback 데이터로 대체", project_id
        )
        tasks_df = generate_synthetic_tasks(n_members=7)
        source = "synthetic_fallback"

    if tasks_df.empty:
        return WorkloadScoreData(
            project_id=project_id,
            source=source,
            method="N/A",
            members=[],
            note="배정된 업무가 없어 편중 점수를 계산할 수 없습니다.",
        )

    features = build_features(tasks_df, embedding_adjustments=embedding_adjustments)
    result = detect_overload_anomalies_auto(features)

    members = [
        WorkloadMemberResult(
            assignee_id=row["assignee_id"],
            task_count_total=int(row["task_count_total"]),
            completion_rate=round(float(row["completion_rate"]), 3),
            overload_score=round(float(row["overload_score_0_100"]), 1),
            is_anomaly=bool(row["is_anomaly"]),
            anomaly_type=row["anomaly_type"],
            task_count_active_rel=round(float(row["task_count_active_rel"]), 3),
            task_count_total_rel=round(float(row["task_count_total_rel"]), 3),
            difficulty_avg_rel=round(float(row["difficulty_avg_rel"]), 3),
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
