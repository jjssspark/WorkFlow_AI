import { apiFetch } from "./apiClient";

export type ReviewerApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ReviewerApplicationSummary {
  userId: number;
  name: string;
  email: string;
  affiliation: string | null;
  facultyId: string | null;
  status: ReviewerApplicationStatus;
  createdAt: string;
  rejectionReason: string | null;
}

export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** 관리자가 심사자 가입 신청 목록을 상태별로 조회할 때 호출한다. 관리자만 호출 가능(403 FORBIDDEN). */
export function listReviewerApplications(status: ReviewerApplicationStatus, page = 0, size = 20) {
  return apiFetch<PageResponse<ReviewerApplicationSummary>>(
    `/admin/reviewers?status=${status}&page=${page}&size=${size}`
  );
}

/** 심사자 신청을 승인한다. 이미 처리된 신청이면 409(REVIEWER_STATUS_CONFLICT). */
export function approveReviewerApplication(userId: number) {
  return apiFetch<void>(`/admin/reviewers/${userId}/approve`, { method: "POST" });
}

/** 심사자 신청을 거부한다. 사유는 필수. 이미 처리된 신청이면 409(REVIEWER_STATUS_CONFLICT). */
export function rejectReviewerApplication(userId: number, reason: string) {
  return apiFetch<void>(`/admin/reviewers/${userId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
