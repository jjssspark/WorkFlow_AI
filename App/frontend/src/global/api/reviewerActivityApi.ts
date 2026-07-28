import { apiFetch } from "./apiClient";

export interface ReviewerActivity {
  projectId: number;
  projectTitle: string;
  activityType: string;
  /** 화면에 그대로 표시할 활동 문구(예: "프로젝트 접속"). 문구는 백엔드가 소유한다. */
  activityLabel: string;
  createdAt: string;
}

export interface ProjectLastAccess {
  projectId: number;
  lastAccessedAt: string;
}

export interface ReviewerActivityHome {
  activities: ReviewerActivity[];
  lastAccess: ProjectLastAccess[];
}

export function fetchReviewerActivities() {
  return apiFetch<ReviewerActivityHome>("/me/reviewer-activities");
}

export function recordReviewerAccess(projectId: number) {
  return apiFetch<null>(`/projects/${projectId}/reviewer-access`, { method: "POST" });
}
