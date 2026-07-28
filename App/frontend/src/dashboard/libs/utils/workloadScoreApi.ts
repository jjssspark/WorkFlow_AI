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
