import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { useAuth } from "./useAuth";
import type { ProjectRoleKo } from "../api/authTypes";

export function RequireAuth() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">로딩 중...</div>
    );
  }
  if (!isAuthenticated) {
    // 초대 링크는 로그인 후 배너로 안내해 이어서 참여할 수 있도록 경로를 남겨둔다 (AppShell 참고).
    if (location.pathname.startsWith("/invite/")) {
      sessionStorage.setItem("pendingInvite", location.pathname);
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export function RequireRole({ allow }: { allow: ProjectRoleKo[] }) {
  const { currentProject, projectRoles } = useAuth();
  const { projectId } = useParams();

  const currentRole = projectId
    ? projectRoles.find(pr => String(pr.projectId) === projectId)?.role
    : currentProject?.role ?? projectRoles[0]?.role;

  if (!currentRole || !allow.includes(currentRole)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
