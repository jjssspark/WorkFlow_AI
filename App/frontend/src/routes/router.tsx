import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router";
import { Toaster } from "../global/component/ui/sonner";
import { RequireAuth, RequireRole, RequireAdmin } from "../global/hooks/useAuthGuard";
import { AppShell } from "../global/component/layout/AppShell";
import { NotificationProvider } from "../global/hooks/useNotifications";
import { LoginScreen } from "../auth/screen/LoginScreen";
import { SignupScreen } from "../auth/screen/SignupScreen";
import { TermsScreen } from "../auth/screen/TermsScreen";
import { OnboardingScreen } from "../auth/screen/OnboardingScreen";
import { ProjectEntryScreen } from "../auth/screen/ProjectEntryScreen";
import { GoogleCallbackScreen } from "../auth/screen/GoogleCallbackScreen";
import { InviteAcceptScreen } from "../auth/screen/InviteAcceptScreen";
import { AdminReviewerApprovalScreen } from "../admin/screen/AdminReviewerApprovalScreen";
import { DashboardView } from "../dashboard/screen/DashboardView";
import { AllTasksPage } from "../dashboard/screen/detail/AllTasksPage";
import { ProgressPage } from "../dashboard/screen/detail/ProgressPage";
import { BlockersPage } from "../dashboard/screen/detail/BlockersPage";
import { InProgressPage } from "../dashboard/screen/detail/InProgressPage";
import { DashProgressPage } from "../dashboard/screen/detail/DashProgressPage";
import { UrgentTasksPage } from "../dashboard/screen/detail/UrgentTasksPage";
import { WorkloadPage } from "../dashboard/screen/detail/WorkloadPage";
import { ActivityPage } from "../dashboard/screen/detail/ActivityPage";
import { BoardView } from "../board/screen/BoardView";
import { CompletionApprovalsView } from "../board/screen/CompletionApprovalsView";
import { LeaderPage } from "../leader/screen/LeaderPage";
import { RoadmapView } from "../roadmap/screen/RoadmapView";
import { MeetingsView } from "../meetings/screen/MeetingsView";
import { DeliverablesView } from "../deliverables/screen/DeliverablesView";
import { ContributorsView } from "../contributors/screen/ContributorsView";
import { MyPageRoute } from "../mypage/screen/MyPageRoute";
import { ProfileSettingsScreen } from "../mypage/screen/ProfileSettingsScreen";

/**
 * Toaster를 모든 경로의 바깥 레이아웃에 둔다. 로그인 직후 밀린 알림 토스트는 아직 AppShell
 * 밖(/login·/projects)에서 발행되는데, sonner는 Toaster가 없을 때 발행된 토스트를 나중에
 * 다시 보여주지 않으므로 AppShell 안에만 두면 그 알림들이 그대로 사라진다.
 * 토스트 내용(NotificationToast)이 useNavigate를 쓰므로 라우터 안이어야 한다.
 */
function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster position="top-right" />
    </>
  );
}

const appRoutes: RouteObject[] = [
  { path: "/login", element: <LoginScreen /> },
  { path: "/signup", element: <SignupScreen /> },
  { path: "/terms", element: <TermsScreen /> },
  { path: "/auth/callback", element: <GoogleCallbackScreen /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/onboarding", element: <OnboardingScreen /> },
      { path: "/projects", element: <ProjectEntryScreen /> },
      { path: "/invite/:token", element: <InviteAcceptScreen /> },
      {
        element: <RequireAdmin />,
        children: [
          { path: "/admin/reviewers", element: <AdminReviewerApprovalScreen /> },
        ],
      },
      {
        element: <NotificationProvider><AppShell /></NotificationProvider>,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <DashboardView /> },
          { path: "dashboard/all-tasks", element: <AllTasksPage /> },
          { path: "dashboard/progress", element: <ProgressPage /> },
          { path: "dashboard/blockers", element: <BlockersPage /> },
          { path: "dashboard/inprogress", element: <InProgressPage /> },
          { path: "dashboard/dash-progress", element: <DashProgressPage /> },
          { path: "dashboard/urgent", element: <UrgentTasksPage /> },
          { path: "dashboard/workload", element: <WorkloadPage /> },
          { path: "dashboard/activity", element: <ActivityPage /> },
          { path: "board", element: <BoardView /> },
          {
            element: <RequireRole allow={["팀장"]} />,
            children: [
              {
                path: "leader",
                element: <LeaderPage />,
                children: [
                  { index: true, element: <Navigate to="roadmap" replace /> },
                  { path: "roadmap", element: <RoadmapView /> },
                  { path: "completion-approvals", element: <CompletionApprovalsView /> },
                ],
              },
            ],
          },
          { path: "completion-approvals", element: <Navigate to="/leader/completion-approvals" replace /> },
          { path: "roadmap", element: <Navigate to="/leader/roadmap" replace /> },
          { path: "meetings", element: <MeetingsView /> },
          { path: "deliverables", element: <DeliverablesView /> },
          {
            element: <RequireRole allow={["심사자"]} />,
            children: [
              { path: "contributors", element: <ContributorsView /> },
            ],
          },
          { path: "mypage", element: <MyPageRoute /> },
          { path: "mypage/settings", element: <ProfileSettingsScreen /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/login" replace /> },
];

export const routes: RouteObject[] = [{ element: <RootLayout />, children: appRoutes }];

export const router = createBrowserRouter(routes);
