import { apiFetch } from "./apiClient";

export interface ReviewerActivityDto {
  id: string;
  projectTitle: string;
  message: string;
  createdAt: string;
}

export interface ProjectLastAccessDto {
  projectId: number;
  lastAccessedAt: string;
}

/** 심사자 홈 "최근 심사 활동" 위젯 — 로그인한 심사자 본인이 남긴 활동 최신순 최대 10건. */
export function fetchReviewerActivities(): Promise<ReviewerActivityDto[]> {
  return apiFetch<ReviewerActivityDto[]>("/me/reviewer-activities");
}

/** 배정 프로젝트 목록을 최근 접속순으로 정렬하기 위한 프로젝트별 마지막 접속 시각. */
export function fetchReviewerLastAccess(): Promise<ProjectLastAccessDto[]> {
  return apiFetch<ProjectLastAccessDto[]>("/me/reviewer-last-access");
}

/** 심사자가 홈에서 배정 프로젝트로 진입할 때 호출 — "최근 접속 날짜"와 목록 정렬의 근거가 된다. */
export function recordReviewerAccess(projectId: number) {
  return apiFetch<null>(`/projects/${projectId}/reviewer-access`, { method: "POST" });
}
