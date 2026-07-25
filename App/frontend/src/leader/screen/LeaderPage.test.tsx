import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../global/hooks/useAuth";
import { LeaderPage } from "./LeaderPage";

vi.mock("../libs/hooks/usePendingApprovalCount", () => ({
  usePendingApprovalCount: () => 0,
}));

function renderLeaderPage(initialPath: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/leader" element={<LeaderPage />}>
            <Route index element={<Navigate to="completion-approvals" replace />} />
            <Route path="completion-approvals" element={<div>APPROVALS_CONTENT</div>} />
            <Route path="roadmap" element={<div>ROADMAP_CONTENT</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("LeaderPage", () => {
  it("renders both tab buttons and the matched child route", () => {
    renderLeaderPage("/leader/completion-approvals");

    expect(screen.getByRole("link", { name: "완료승인 대기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로드맵" })).toBeInTheDocument();
    expect(screen.getByText("APPROVALS_CONTENT")).toBeInTheDocument();
  });

  it("switches to the roadmap tab when clicked", async () => {
    renderLeaderPage("/leader/completion-approvals");

    await userEvent.click(screen.getByRole("link", { name: "로드맵" }));

    expect(screen.getByText("ROADMAP_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("APPROVALS_CONTENT")).not.toBeInTheDocument();
  });

  it("redirects /leader to the completion-approvals tab by default", () => {
    renderLeaderPage("/leader");

    expect(screen.getByText("APPROVALS_CONTENT")).toBeInTheDocument();
  });
});
