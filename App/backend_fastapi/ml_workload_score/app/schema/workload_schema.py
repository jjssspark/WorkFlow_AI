from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel

CURRENT_WORKLOAD_SCHEMA_VERSION = "1.0"


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
