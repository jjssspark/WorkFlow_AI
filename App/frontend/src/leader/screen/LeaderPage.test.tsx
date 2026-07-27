import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { LeaderPage } from "./LeaderPage";

function renderLeaderPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/leader" element={<LeaderPage />}>
          <Route index element={<Navigate to="roadmap" replace />} />
          <Route path="roadmap" element={<div>ROADMAP_CONTENT</div>} />
          <Route path="completion-approvals" element={<div>APPROVALS_CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("LeaderPage", () => {
  it("renders both tab buttons and the matched child route", () => {
    renderLeaderPage("/leader/completion-approvals");

    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["로드맵", "완료승인 대기"]);
    expect(screen.getByText("APPROVALS_CONTENT")).toBeInTheDocument();
  });

  it("switches to the roadmap tab when clicked", async () => {
    renderLeaderPage("/leader/completion-approvals");

    await userEvent.click(screen.getByRole("link", { name: "로드맵" }));

    expect(screen.getByText("ROADMAP_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("APPROVALS_CONTENT")).not.toBeInTheDocument();
  });

  it("redirects /leader to the roadmap tab by default", () => {
    renderLeaderPage("/leader");

    expect(screen.getByText("ROADMAP_CONTENT")).toBeInTheDocument();
  });
});
