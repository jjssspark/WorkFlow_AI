import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../hooks/useAuth";
import { AppShell } from "./AppShell";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={["/board"]}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders the sidebar expanded by default", () => {
    renderAppShell();
    expect(screen.getByText("TeamFlow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toBeInTheDocument();
  });

  it("collapses the sidebar when the toggle is clicked and keeps it collapsed after remount", async () => {
    const { unmount } = renderAppShell();
    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.queryByText("TeamFlow")).not.toBeInTheDocument();
    unmount();

    renderAppShell();
    expect(screen.queryByText("TeamFlow")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeInTheDocument();
  });

  it("opens the AI panel and forwards a requested dashboard question", async () => {
    renderAppShell();

    act(() => openAIAssistant("현재 프로젝트 진행률을 요약해줘"));

    expect(await screen.findByText("현재 프로젝트 진행률을 요약해줘")).toBeInTheDocument();
  });

  it("sessionStorage에 pendingInvite가 있으면 초대 안내 배너를 보여준다", () => {
    sessionStorage.setItem("pendingInvite", "/invite/AQ28CU79");
    renderAppShell();
    expect(screen.getByText("참여 대기 중인 초대가 있습니다.")).toBeInTheDocument();
  });

  it("pendingInvite가 없으면 배너를 보여주지 않는다", () => {
    renderAppShell();
    expect(screen.queryByText("참여 대기 중인 초대가 있습니다.")).not.toBeInTheDocument();
  });

  it("닫기를 누르면 배너가 사라지고 sessionStorage에서도 제거된다", async () => {
    sessionStorage.setItem("pendingInvite", "/invite/AQ28CU79");
    renderAppShell();

    await userEvent.click(screen.getByRole("button", { name: "초대 안내 닫기" }));

    expect(screen.queryByText("참여 대기 중인 초대가 있습니다.")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("pendingInvite")).toBeNull();
  });

  it("참여하기를 누르면 배너가 사라진다", async () => {
    sessionStorage.setItem("pendingInvite", "/invite/AQ28CU79");
    renderAppShell();

    await userEvent.click(screen.getByRole("button", { name: "참여하기" }));

    expect(screen.queryByText("참여 대기 중인 초대가 있습니다.")).not.toBeInTheDocument();
  });
});
