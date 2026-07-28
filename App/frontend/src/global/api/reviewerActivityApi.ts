import { apiFetch } from "./apiClient";

export interface ReviewerActivityDto {
  id: string;
  projectTitle: string;
  message: string;
  createdAt: string;
}

/** 심사자 홈 "최근 심사 활동" 위젯 — 로그인한 심사자 본인이 남긴 활동 최신순 최대 10건. */
export function fetchReviewerActivities(): Promise<ReviewerActivityDto[]> {
  return apiFetch<ReviewerActivityDto[]>("/me/reviewer-activities");
}
