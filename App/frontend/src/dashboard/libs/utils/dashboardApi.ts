import type { ActivityItemDto, DashboardAiJobResponse, DashboardSummaryResponse, DashboardTaskDto, ProgressDetailResponse } from "../types/dashboard";
import { apiFetch } from "../../../global/api/apiClient";

export async function fetchDashboardSummary(projectId: string | number): Promise<DashboardSummaryResponse> {
  return apiFetch<DashboardSummaryResponse>(`/projects/${projectId}/dashboard/summary`);
}

export async function fetchDashboardProgress(projectId: string | number): Promise<ProgressDetailResponse> {
  return apiFetch<ProgressDetailResponse>(`/projects/${projectId}/dashboard/progress`);
}

export async function fetchDashboardTasks(projectId: string | number): Promise<DashboardTaskDto[]> {
  return apiFetch<DashboardTaskDto[]>(`/projects/${projectId}/dashboard/tasks`);
}

export async function fetchDashboardActivities(projectId: string | number): Promise<ActivityItemDto[]> {
  return apiFetch<ActivityItemDto[]>(`/projects/${projectId}/dashboard/activities`);
}

// 지연 위험도 재분석은 Redis Queue(dashboard-ai-jobs)로 처리된다 — POST는 즉시 jobId를 담아
// 응답하고, 실제 재분석은 백그라운드에서 실행된다. 완료 여부는 아래 상태 조회로 폴링한다.
export async function enqueueDelayRiskRefresh(projectId: string | number): Promise<DashboardAiJobResponse> {
  return apiFetch<DashboardAiJobResponse>(`/projects/${projectId}/dashboard/delay-risk/refresh`, {
    method: "POST",
  });
}

export async function fetchDelayRiskRefreshStatus(
  projectId: string | number,
  jobId: string
): Promise<DashboardAiJobResponse> {
  return apiFetch<DashboardAiJobResponse>(`/projects/${projectId}/dashboard/delay-risk/refresh/${jobId}`);
}
