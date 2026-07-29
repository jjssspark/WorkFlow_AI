export type ProjectRoleKo = "팀장" | "팀원" | "심사자";

export interface UserSummary {
  id: number;
  email: string;
  name: string;
  affiliation: string | null;
  field: string[] | null;
  githubUsername: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface ProjectRoleSummary {
  projectId: number;
  projectTitle: string | null;
  role: ProjectRoleKo;
  type: string | null;
  year: number | null;
  taskProgress: number;
}

export interface MeResponse {
  user: UserSummary;
  projectRoles: ProjectRoleSummary[];
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserSummary;
  testSessionId?: string | null;
}

export interface SignupResponse {
  status: "ACTIVE" | "PENDING_REVIEWER_APPROVAL";
  tokens: AuthTokenResponse | null;
}
