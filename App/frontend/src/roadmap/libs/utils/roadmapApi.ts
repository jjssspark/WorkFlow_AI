import { apiFetch } from "../../../global/api/apiClient";
import type { RoadmapMilestone, RoadmapResponse, RoadmapTask } from "../types/roadmap";

export interface MilestoneInput {
  title: string;
  startDate: string | null;
  dueDate: string | null;
}

export interface QuickTaskInput {
  title: string;
  assigneeId?: string | null;
  category?: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
}

export function fetchRoadmap(projectId: string | number): Promise<RoadmapResponse> {
  return apiFetch<RoadmapResponse>(`/projects/${projectId}/roadmap`);
}

export function createMilestone(projectId: string | number, input: MilestoneInput): Promise<RoadmapMilestone> {
  return apiFetch<RoadmapMilestone>(`/projects/${projectId}/roadmap/milestones`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteMilestone(projectId: string | number, milestoneId: string): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/roadmap/milestones/${milestoneId}`, {
    method: "DELETE",
  });
}

export function createRoadmapTask(
  projectId: string | number,
  milestoneId: string,
  input: QuickTaskInput,
): Promise<RoadmapTask> {
  return apiFetch<RoadmapTask>(`/projects/${projectId}/roadmap/milestones/${milestoneId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function moveRoadmapTask(
  projectId: string | number,
  taskId: string,
  milestoneId: string | null,
): Promise<RoadmapTask> {
  return apiFetch<RoadmapTask>(`/projects/${projectId}/roadmap/tasks/${taskId}/milestone`, {
    method: "PATCH",
    body: JSON.stringify({ milestoneId: milestoneId === null ? null : Number(milestoneId) }),
  });
}

export function updateRoadmapTaskPosition(
  projectId: string | number,
  taskId: string,
  status: string,
  position: number,
): Promise<unknown> {
  return apiFetch(`/projects/${projectId}/tasks/${taskId}/position`, {
    method: "PATCH",
    body: JSON.stringify({ status, position }),
  });
}
