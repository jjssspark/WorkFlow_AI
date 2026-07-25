import { createBrowserRouter, Navigate } from "react-router";
import { RequireAuth, RequireRole } from "../global/hooks/useAuthGuard";
import { AppShell } from "../global/component/layout/AppShell";
import { LoginScreen } from "../auth/screen/LoginScreen";
import { SignupScreen } from "../auth/screen/SignupScreen";
import { TermsScreen } from "../auth/screen/TermsScreen";
import { OnboardingScreen } from "../auth/screen/OnboardingScreen";
import { ProjectEntryScreen } from "../auth/screen/ProjectEntryScreen";
import { GoogleCallbackScreen } from "../auth/screen/GoogleCallbackScreen";
import { InviteAcceptScreen } from "../auth/screen/InviteAcceptScreen";
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
import { MeetingsView } from "../meetings/screen/MeetingsView";
import { DeliverablesView } from "../deliverables/screen/DeliverablesView";
import { ContributorsView } from "../contributors/screen/ContributorsView";
import { MyPageRoute } from "../mypage/screen/MyPageRoute";
import { ProfileSettingsScreen } from "../mypage/screen/ProfileSettingsScreen";

export const router = createBrowserRouter([
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
        element: <AppShell />,
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
              { path: "completion-approvals", element: <CompletionApprovalsView /> },
            ],
          },
          { path: "roadmap", element: <Navigate to="/dashboard" replace /> },
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
]);
