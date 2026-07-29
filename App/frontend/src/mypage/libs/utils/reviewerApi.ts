import { apiFetch } from "../../../global/api/apiClient";

export interface ReviewerProject {
  projectId: number;
  title: string;
  type: string | null;
  leaderName: string | null;
  memberCount: number;
  progressPercent: number;
  evalStatus: "pending" | "evaluating" | "published";
  deliverablesSubmitted: number;
  deliverablesTotal: number;
  githubConnected: boolean;
}

export async function fetchReviewerProjects(): Promise<ReviewerProject[]> {
  return apiFetch<ReviewerProject[]>("/me/reviewer-projects");
}
