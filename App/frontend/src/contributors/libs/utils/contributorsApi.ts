import { apiFetch } from "../../../global/api/apiClient";

interface RawMemberContribution {
  user_id: number;
  name: string;
  summary: string;
  evidence: string[];
}

export interface MemberContributionDto {
  userId: number;
  name: string;
  summary: string;
  evidence: string[];
}

export async function fetchContributionReport(projectId: number): Promise<MemberContributionDto[]> {
  const data = await apiFetch<RawMemberContribution[]>("/ai/contribution/report", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  });

  return data.map((item) => ({
    userId: item.user_id,
    name: item.name,
    summary: item.summary,
    evidence: item.evidence,
  }));
}

interface RawContributionMemberScore {
  assignee_id: string;
  workload_component: number;
  task_component: number;
  meeting_component: number;
  contribution_score: number;
  anomaly_type: string;
  task_count_active_rel: number;
  task_count_total_rel: number;
  difficulty_avg_rel: number;
  overdue_count: number;
}

interface RawContributionScoreData {
  schema_version: string;
  project_id: number;
  members: RawContributionMemberScore[];
  note: string | null;
  team_mean_completion: number | null;
}

export interface ContributionMemberScoreDto {
  assigneeId: string;
  workloadComponent: number;
  taskComponent: number;
  meetingComponent: number;
  contributionScore: number;
  anomalyType: string;
  taskCountActiveRel: number;
  taskCountTotalRel: number;
  difficultyAvgRel: number;
  overdueCount: number;
}

export interface ContributionScoreResult {
  members: ContributionMemberScoreDto[];
  note: string | null;
  // anomaly_type(과부하/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율(0~1).
  // 팀원이 없어 계산 자체가 없었으면 null.
  teamMeanCompletion: number | null;
}

export async function fetchContributionScore(projectId: number): Promise<ContributionScoreResult> {
  const data = await apiFetch<RawContributionScoreData>("/ai/contribution/score", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  });

  return {
    members: data.members.map((m) => ({
      assigneeId: m.assignee_id,
      workloadComponent: m.workload_component,
      taskComponent: m.task_component,
      meetingComponent: m.meeting_component,
      contributionScore: m.contribution_score,
      anomalyType: m.anomaly_type,
      taskCountActiveRel: m.task_count_active_rel,
      taskCountTotalRel: m.task_count_total_rel,
      difficultyAvgRel: m.difficulty_avg_rel,
      overdueCount: m.overdue_count,
    })),
    note: data.note,
    teamMeanCompletion: data.team_mean_completion,
  };
}
