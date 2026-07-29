import { apiFetch } from "./apiClient";
import type { ProjectRoleKo } from "./authTypes";

export interface ProjectResponse {
  id: number;
  title: string;
  type: string | null;
  deadline: string | null;
  description: string | null;
  startDate: string | null;
  midCheckDate: string | null;
  memberLimit: number | null;
  deliverables: string[] | null;
  techStack: string[] | null;
  goals: string | null;
  inviteCode: string | null;
  createdBy: number | null;
  memberCount: number;
  taskProgress: number;
  // 평가 진행 상태(PENDING/EVALUATING/PUBLISHED). 심사자가 기여도 분석 화면에서
  // "평가 확정"을 누르면 PUBLISHED로 전이한다 - App/global/lib/evalStatus.ts 참고.
  evalStatus: string;
}

export interface CreateProjectRequest {
  title: string;
  type?: string;
  description?: string;
  startDate?: string;
  deadline?: string;
  midCheckDate?: string;
  memberLimit?: number;
  deliverables?: string[];
  techStack?: string[];
  goals?: string;
}

export type UpdateProjectRequest = Partial<CreateProjectRequest>;

export function listProjects() {
  return apiFetch<ProjectResponse[]>("/projects");
}

export function createProject(request: CreateProjectRequest) {
  return apiFetch<ProjectResponse>("/projects", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function getProject(projectId: number) {
  return apiFetch<ProjectResponse>(`/projects/${projectId}`);
}

export function updateProject(projectId: number, request: UpdateProjectRequest) {
  return apiFetch<ProjectResponse>(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(request),
  });
}

export function joinProjectByCode(code: string) {
  return apiFetch<ProjectResponse>("/projects/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// 심사자가 기여도 분석 화면의 "평가 확정" 버튼을 누를 때 호출한다.
// 프로젝트의 eval_status를 PUBLISHED로 전이한다(REVIEWER 권한 필요).
export function finalizeEvaluation(projectId: number) {
  return apiFetch<ProjectResponse>(`/projects/${projectId}/finalize-evaluation`, {
    method: "POST",
  });
}

// 심사자가 기여도 분석 화면의 "평가 확정 취소" 버튼을 누를 때 호출한다.
// 프로젝트의 eval_status를 EVALUATING으로 되돌린다(REVIEWER 권한 필요).
// 팀원별 점수/공개 여부는 변경하지 않는다 — 상태 배지/버튼만 되돌린다.
export function unfinalizeEvaluation(projectId: number) {
  return apiFetch<ProjectResponse>(`/projects/${projectId}/unfinalize-evaluation`, {
    method: "POST",
  });
}

export interface MemberResponse {
  userId: number;
  name: string;
  email: string;
  role: ProjectRoleKo;
}

export function getProjectMembers(projectId: number) {
  return apiFetch<MemberResponse[]>(`/projects/${projectId}/members`);
}

export interface InvitationResponse {
  projectId: number;
  email: string;
  role: ProjectRoleKo;
  token: string;
  status: string;
  expiresAt: string;
}

export function createInvitation(projectId: number, email: string, role: ProjectRoleKo) {
  return apiFetch<InvitationResponse>(`/projects/${projectId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export function acceptInvitation(token: string) {
  return apiFetch<void>(`/invitations/${token}/accept`, {
    method: "POST",
  });
}

export function touchProjectAccess(projectId: number) {
  return apiFetch<void>(`/projects/${projectId}/access`, { method: "POST" });
}
