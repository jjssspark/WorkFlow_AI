import { apiFetch } from "../../../global/api/apiClient";
import type { DashboardAiJobResponse } from "../types/dashboard";

// Spring dashboard.workload-score 엔드포인트는 ml_workload_score(FastAPI) 응답을
// 필드명 그대로 통과시키므로(dashboard.ts의 다른 camelCase DTO와 달리) snake_case로 온다.
interface RawWorkloadScoreMember {
  assignee_id: string;
  task_count_total: number;
  completion_rate: number;
  overload_score: number;
  is_anomaly: boolean;
  anomaly_type: string;
  task_count_active_rel: number;
  difficulty_avg_rel: number;
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
  calculated_at: string | null;
}

export interface WorkloadScoreMemberDto {
  assigneeId: string;
  taskCountTotal: number;
  completionRate: number;
  overloadScore: number;
  isAnomaly: boolean;
  anomalyType: string;
  taskCountActiveRel: number;
  difficultyAvgRel: number;
  overdueCount: number;
}

export interface WorkloadScoreResult {
  source: string;
  method: string;
  members: WorkloadScoreMemberDto[];
  note: string | null;
  // anomaly_type(과부하/저활동 의심) 판정에 실제로 쓰인 팀 평균 완료율(0~1).
  teamMeanCompletion: number | null;
  // 이 결과를 실제로 계산한 시각(ISO-8601). GET은 마지막 계산 결과를 캐시에서 돌려주므로
  // 화면이 "언제 기준 값인지" 밝혀야 한다. 계산 시각을 기록하기 전의 옛 캐시면 null.
  calculatedAt: string | null;
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
      anomalyType: m.anomaly_type,
      taskCountActiveRel: m.task_count_active_rel,
      difficultyAvgRel: m.difficulty_avg_rel,
      overdueCount: m.overdue_count,
    })),
    note: data.note,
    teamMeanCompletion: data.team_mean_completion,
    calculatedAt: data.calculated_at,
  };
}

// 업무 편중 점수 재계산도 Redis Queue(dashboard-ai-jobs)로 처리된다 — GET /workload-score는
// 이제 마지막으로 캐시된 값을 돌려줄 뿐이므로, 새로 계산하려면 이 재계산 요청을 먼저 적재해야 한다.
export async function enqueueWorkloadScoreRefresh(projectId: string | number): Promise<DashboardAiJobResponse> {
  return apiFetch<DashboardAiJobResponse>(`/projects/${projectId}/dashboard/workload-score/refresh`, {
    method: "POST",
  });
}

export async function fetchWorkloadScoreRefreshStatus(
  projectId: string | number,
  jobId: string
): Promise<DashboardAiJobResponse> {
  return apiFetch<DashboardAiJobResponse>(`/projects/${projectId}/dashboard/workload-score/refresh/${jobId}`);
}
