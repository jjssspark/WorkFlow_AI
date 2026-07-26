import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_BASE_URL, apiFetch, AUTH_LOGOUT_EVENT } from "../api/apiClient";
import { tokenStore } from "../api/tokenStore";
import type { MeResponse, ProjectRoleSummary, UserSummary } from "../api/authTypes";

const SELECTED_PROJECT_KEY = "workflow-ai:selected-project-id";
const HEARTBEAT_INTERVAL_MS = 20000;

interface AuthState {
  isAuthenticated: boolean;
  loading: boolean;
  user: UserSummary | null;
  projectRoles: ProjectRoleSummary[];
  currentProjectId: number | null;
  currentProject: ProjectRoleSummary | null;
  selectProject: (projectId: number) => void;
  addLocalProjectRole: (projectTitle: string, role: ProjectRoleSummary["role"]) => number;
  loginWithGoogle: () => void;
  logout: () => void;
  refreshMe: () => Promise<MeResponse | undefined>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [serverProjectRoles, setServerProjectRoles] = useState<ProjectRoleSummary[]>([]);
  const [localProjectRoles, setLocalProjectRoles] = useState<ProjectRoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const projectRoles = useMemo(
    () => [...serverProjectRoles, ...localProjectRoles],
    [serverProjectRoles, localProjectRoles],
  );

  // projectRoles가 (최초 로드/새 프로젝트 생성 등으로) 바뀔 때마다, 저장된 선택이 여전히 유효하면 유지하고
  // 아니면(첫 로드, 그 프로젝트에서 빠짐 등) 첫 번째 프로젝트로 폴백한다.
  useEffect(() => {
    if (projectRoles.length === 0) {
      setCurrentProjectId(null);
      return;
    }
    const stored = Number(localStorage.getItem(SELECTED_PROJECT_KEY));
    const stillValid = stored && projectRoles.some((pr) => pr.projectId === stored);
    setCurrentProjectId(stillValid ? stored : projectRoles[0].projectId);
  }, [projectRoles]);

  const selectProject = (projectId: number) => {
    setCurrentProjectId(projectId);
    localStorage.setItem(SELECTED_PROJECT_KEY, String(projectId));
  };

  const addLocalProjectRole = (projectTitle: string, role: ProjectRoleSummary["role"]) => {
    const projectId = -Date.now();
    setLocalProjectRoles((prev) => [
      { projectId, projectTitle, role },
      ...prev.filter((project) => project.projectTitle !== projectTitle),
    ]);
    selectProject(projectId);
    return projectId;
  };

  const currentProject = projectRoles.find((pr) => pr.projectId === currentProjectId) ?? null;

  const loadMe = async (): Promise<MeResponse | undefined> => {
    if (!tokenStore.getAccessToken()) {
      setUser(null);
      setServerProjectRoles([]);
      setLoading(false);
      return undefined;
    }
    try {
      const me = await apiFetch<MeResponse>("/me");
      setUser(me.user);
      setServerProjectRoles(me.projectRoles);
      return me;
    } catch (err) {
      tokenStore.clear();
      setUser(null);
      setServerProjectRoles([]);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMe().catch(() => {});

    const handleForcedLogout = () => {
      setUser(null);
      setServerProjectRoles([]);
      setLocalProjectRoles([]);
    };
    window.addEventListener(AUTH_LOGOUT_EVENT, handleForcedLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handleForcedLogout);
  }, []);

  // 로그인 중인 동안 주기적으로 접속 상태를 갱신한다(중간보고/시연용 접속자 표시 + 동시 로그인 제한용 heartbeat).
  useEffect(() => {
    if (!user) return;
    const heartbeat = () => {
      apiFetch("/auth/test-session/heartbeat", { method: "POST" }).catch(() => {});
    };
    heartbeat();
    const intervalId = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [user]);

  const loginWithGoogle = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const logout = () => {
    apiFetch("/auth/test-logout", { method: "POST" }).catch(() => {});
    apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    tokenStore.clear();
    setUser(null);
    setServerProjectRoles([]);
    setLocalProjectRoles([]);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        loading,
        user,
        projectRoles,
        currentProjectId,
        currentProject,
        selectProject,
        addLocalProjectRole,
        loginWithGoogle,
        logout,
        refreshMe: loadMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
