import { apiFetch } from "../../../global/api/apiClient";
import type { MilestoneProgressDto } from "../types/dashboard";

export interface CreateMilestoneInput {
  title: string;
  startDate: string | null;
  dueDate: string | null;
}

export async function createMilestone(
  projectId: string | number,
  input: CreateMilestoneInput
): Promise<MilestoneProgressDto> {
  return apiFetch<MilestoneProgressDto>(`/projects/${projectId}/dashboard/milestones`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMilestone(
  projectId: string | number,
  milestoneId: string,
  input: CreateMilestoneInput
): Promise<MilestoneProgressDto> {
  return apiFetch<MilestoneProgressDto>(`/projects/${projectId}/dashboard/milestones/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteMilestone(projectId: string | number, milestoneId: string): Promise<void> {
  await apiFetch<null>(`/projects/${projectId}/dashboard/milestones/${milestoneId}`, { method: "DELETE" });
}
