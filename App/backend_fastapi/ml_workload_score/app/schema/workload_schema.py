from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel

CURRENT_WORKLOAD_SCHEMA_VERSION = "1.0"


class WorkloadMemberResult(BaseModel):
    assignee_id: str
    task_count_total: int
    completion_rate: float
    overload_score: float
    is_anomaly: bool
    anomaly_type: str
    # --- 편중도 근거 패널용 신규 필드 (build_features()가 이미 계산하던 값) ---
    task_count_active_rel: float
    # "배정량 불균형" 판정 및 근거 문구 전용: 애초에 배정받은 전체 업무 수의 팀 평균 대비 비율.
    # task_count_active_rel(진행중 업무 비율)로 이를 판단하면 배정된 업무를 전부
    # 끝낸 사람도 진행중 업무가 0이 되어 무조건 걸리는 문제가 있으므로 이 필드를 대신 쓴다.
    task_count_total_rel: float
    difficulty_avg_rel: float
    overdue_count: int


class WorkloadScoreData(BaseModel):
    schema_version: str = CURRENT_WORKLOAD_SCHEMA_VERSION
    project_id: int
    source: str  # "db" | "synthetic_fallback"
    method: str  # "MAD (소규모 팀)" | "Isolation Forest (대규모)"
    members: List[WorkloadMemberResult]
    note: Optional[str] = None
    # anomaly_type(과부하/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율(0~1).
    # 멤버가 없으면(빈 팀) 계산 자체가 없었으므로 None.
    team_mean_completion: Optional[float] = None


class WorkloadScoreResponse(BaseModel):
    success: bool
    data: Optional[WorkloadScoreData] = None
    error: Optional[dict] = None
