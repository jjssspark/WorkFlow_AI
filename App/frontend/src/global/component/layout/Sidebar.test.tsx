import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRoleSummary } from "../../api/authTypes";
import { RequireRole } from "../../hooks/useAuthGuard";
import { Sidebar } from "./Sidebar";

const mockAuth = vi.hoisted(() => ({
  state: {
    isAuthenticated: true,
    loading: false,
    user: { id: 1, email: "leader@example.com", name: "김팀장" },
    projectRoles: [] as ProjectRoleSummary[],
    currentProjectId: null as number | null,
    currentProject: null as ProjectRoleSummary | null,
    selectProject: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
    refreshMe: vi.fn(),
  },
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockAuth.state,
}));

const mockPendingApprovalCount = vi.hoisted(() => ({ value: 0 }));

vi.mock("../../../leader/libs/hooks/usePendingApprovalCount", () => ({
  usePendingApprovalCount: () => mockPendingApprovalCount.value,
}));

vi.mock("./InviteCodeSection", () => ({
  InviteCodeSection: ({ projectId }: { projectId: number }) => (
    <div data-testid="invite-code-section">invite:{projectId}</div>
  ),
}));

const leaderProject: ProjectRoleSummary = { projectId: 1, projectTitle: "팀장 프로젝트", role: "팀장" };
const memberProject: ProjectRoleSummary = { projectId: 2, projectTitle: "팀원 프로젝트", role: "팀원" };
const reviewerProject: ProjectRoleSummary = { projectId: 3, projectTitle: "심사 프로젝트", role: "심사자" };

function setCurrentProject(project: ProjectRoleSummary, projectRoles: ProjectRoleSummary[] = [project]) {
  mockAuth.state.projectRoles = projectRoles;
  mockAuth.state.currentProjectId = project.projectId;
  mockAuth.state.currentProject = project;
}

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    active: "board",
    onSelect: () => {},
    onAI: () => {},
    collapsed: false,
    onToggleCollapsed: () => {},
    showCollapseToggle: true,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    setCurrentProject(leaderProject);
    mockAuth.state.selectProject.mockClear();
    mockAuth.state.loginWithGoogle.mockClear();
    mockAuth.state.logout.mockClear();
    mockAuth.state.refreshMe.mockClear();
    mockPendingApprovalCount.value = 0;
  });

  it("shows menu labels and logo text when expanded", () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText("업무 보드")).toBeInTheDocument();
    expect(screen.getByText("TeamFlow")).toBeInTheDocument();
  });

  it("hides menu labels, group headers, and logo text when collapsed", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("업무 보드")).not.toBeInTheDocument();
    expect(screen.queryByText("계획 관리")).not.toBeInTheDocument();
    expect(screen.queryByText("TeamFlow")).not.toBeInTheDocument();
  });

  it("keeps the active item visually highlighted when collapsed", () => {
    renderSidebar({ collapsed: true, active: "board" });
    const boardButton = screen.getByRole("button", { name: "업무 보드" });
    expect(boardButton).toHaveStyle({ background: "var(--sidebar-primary)" });
  });

  it("still exposes an accessible name for icon-only buttons when collapsed", () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole("button", { name: "업무 보드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대시보드" })).toBeInTheDocument();
  });

  it("shows a tooltip with the item label when a collapsed icon is hovered", async () => {
    renderSidebar({ collapsed: true });
    const boardButton = screen.getByRole("button", { name: "업무 보드" });
    await userEvent.hover(boardButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("업무 보드");
  });

  it("calls onToggleCollapsed when the toggle button is clicked", async () => {
    const onToggleCollapsed = vi.fn();
    renderSidebar({ onToggleCollapsed, collapsed: false });
    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("labels the toggle button for expanding when already collapsed", () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeInTheDocument();
  });

  it("hides the toggle button entirely when showCollapseToggle is false", () => {
    renderSidebar({ showCollapseToggle: false });
    expect(screen.queryByRole("button", { name: "사이드바 접기" })).not.toBeInTheDocument();
  });

  it("applies the dark scrollbar styling to the nav element", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("scrollbar-thin-dark");
  });

  it("hides reviewer-only navigation when the current project role is not reviewer", () => {
    setCurrentProject(memberProject, [reviewerProject, memberProject]);
    renderSidebar();
    expect(screen.queryByRole("button", { name: "기여도 분석" })).not.toBeInTheDocument();
    expect(screen.queryByText("평가 (심사자 전용)")).not.toBeInTheDocument();
  });

  it("shows reviewer-only navigation for a reviewer current project", () => {
    setCurrentProject(reviewerProject, [leaderProject, reviewerProject]);
    renderSidebar();
    expect(screen.getByRole("button", { name: "기여도 분석" })).toBeInTheDocument();
    expect(screen.getByText("평가 (심사자 전용)")).toBeInTheDocument();
  });

  it("hides the 팀장페이지 menu when the current project role is not leader", () => {
    setCurrentProject(memberProject, [leaderProject, memberProject]);
    renderSidebar();
    expect(screen.queryByRole("button", { name: "팀장페이지" })).not.toBeInTheDocument();
  });

  it("shows the 팀장페이지 menu for a leader current project", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "팀장페이지" })).toBeInTheDocument();
  });

  it("shows a pending-approval count badge on 팀장페이지 when there are pending approvals", () => {
    mockPendingApprovalCount.value = 3;
    renderSidebar();
    const leaderButton = screen.getByRole("button", { name: "팀장페이지" });
    expect(leaderButton).toHaveTextContent("3");
  });

  it("hides the pending-approval badge when the count is 0", () => {
    mockPendingApprovalCount.value = 0;
    renderSidebar();
    const leaderButton = screen.getByRole("button", { name: "팀장페이지" });
    expect(leaderButton).not.toHaveTextContent("0");
  });

  it("팀장이 프로젝트 드롭다운을 열면 초대 코드 영역을 보여준다", async () => {
    setCurrentProject(leaderProject);

    renderSidebar();
    await userEvent.click(screen.getByText("팀장 프로젝트"));

    expect(screen.getByTestId("invite-code-section")).toHaveTextContent("invite:1");
  });

  it("팀원에게는 초대 코드 영역을 보여주지 않는다", async () => {
    setCurrentProject(memberProject);

    renderSidebar();
    await userEvent.click(screen.getByText("팀원 프로젝트"));

    expect(screen.queryByTestId("invite-code-section")).not.toBeInTheDocument();
  });
});

describe("RequireRole", () => {
  beforeEach(() => {
    setCurrentProject(memberProject, [reviewerProject, memberProject]);
  });

  it("redirects away from reviewer-only routes when the current project role is not reviewer", () => {
    render(
      <MemoryRouter initialEntries={["/contributors"]}>
        <Routes>
          <Route element={<RequireRole allow={["심사자"]} />}>
            <Route path="/contributors" element={<div>Reviewer content</div>} />
          </Route>
          <Route path="/dashboard" element={<div>Dashboard fallback</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText("Reviewer content")).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard fallback")).toBeInTheDocument();
  });

  it("allows reviewer-only routes when the current project role is reviewer", () => {
    setCurrentProject(reviewerProject, [leaderProject, reviewerProject]);

    render(
      <MemoryRouter initialEntries={["/contributors"]}>
        <Routes>
          <Route element={<RequireRole allow={["심사자"]} />}>
            <Route path="/contributors" element={<div>Reviewer content</div>} />
          </Route>
          <Route path="/dashboard" element={<div>Dashboard fallback</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Reviewer content")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard fallback")).not.toBeInTheDocument();
  });
});
