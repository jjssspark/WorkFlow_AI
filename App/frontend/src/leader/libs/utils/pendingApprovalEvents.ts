export const PENDING_APPROVAL_COUNT_CHANGED = "workflow:pending-approval-count-changed";

export interface PendingApprovalCountDetail {
  projectId: number;
  count: number;
}

export function publishPendingApprovalCount(projectId: number, count: number): void {
  window.dispatchEvent(new CustomEvent<PendingApprovalCountDetail>(
    PENDING_APPROVAL_COUNT_CHANGED,
    { detail: { projectId, count } },
  ));
}
