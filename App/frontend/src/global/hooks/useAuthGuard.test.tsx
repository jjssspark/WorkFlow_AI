import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAdmin, RequireAuth } from "./useAuthGuard";

const mockAuth = vi.hoisted(() => ({
  state: {
    isAuthenticated: false,
    loading: false,
    user: null as { isAdmin: boolean } | null,
  },
}));

vi.mock("./useAuth", () => ({
  useAuth: () => mockAuth.state,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/invite/:token" element={<div>Invite content</div>} />
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Route>
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockAuth.state.isAuthenticated = false;
  });

  it("미로그인 상태로 초대 링크에 접근하면 pendingInvite를 저장하고 로그인으로 보낸다", () => {
    renderAt("/invite/AQ28CU79");

    expect(screen.getByText("Login screen")).toBeInTheDocument();
    expect(sessionStorage.getItem("pendingInvite")).toBe("/invite/AQ28CU79");
  });

  it("미로그인 상태로 일반 경로에 접근하면 pendingInvite를 저장하지 않는다", () => {
    renderAt("/dashboard");

    expect(screen.getByText("Login screen")).toBeInTheDocument();
    expect(sessionStorage.getItem("pendingInvite")).toBeNull();
  });

  it("로그인 상태면 정상적으로 하위 라우트를 렌더링한다", () => {
    mockAuth.state.isAuthenticated = true;

    renderAt("/invite/AQ28CU79");

    expect(screen.getByText("Invite content")).toBeInTheDocument();
    expect(sessionStorage.getItem("pendingInvite")).toBeNull();
  });
});

function renderAdminAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/reviewers" element={<div>Admin content</div>} />
        </Route>
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAdmin", () => {
  beforeEach(() => {
    mockAuth.state.loading = false;
    mockAuth.state.user = null;
  });

  it("user.isAdmin이 true면 하위 라우트를 렌더링한다", () => {
    mockAuth.state.user = { isAdmin: true };

    renderAdminAt("/admin/reviewers");

    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("user.isAdmin이 false이면 대시보드로 리다이렉트한다", () => {
    mockAuth.state.user = { isAdmin: false };

    renderAdminAt("/admin/reviewers");

    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("user가 null이면 대시보드로 리다이렉트한다", () => {
    mockAuth.state.user = null;

    renderAdminAt("/admin/reviewers");

    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("loading 중이면 로딩 화면을 보여준다", () => {
    mockAuth.state.loading = true;

    renderAdminAt("/admin/reviewers");

    expect(screen.getByText("로딩 중...")).toBeInTheDocument();
  });
});
