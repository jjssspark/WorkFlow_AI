import { apiFetch } from "../../../global/api/apiClient";
import type { MilestoneProgressDto } from "../types/dashboard";

export interface CreateMilestoneInput {
  title: string;
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
