import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteAcceptScreen } from "./InviteAcceptScreen";

const mockAcceptInvitation = vi.hoisted(() => vi.fn());
const mockJoinProjectByCode = vi.hoisted(() => vi.fn());
vi.mock("../../global/api/projectsApi", () => ({
  acceptInvitation: mockAcceptInvitation,
  joinProjectByCode: mockJoinProjectByCode,
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAcceptScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAcceptInvitation.mockReset();
  mockJoinProjectByCode.mockReset();
  mockNavigate.mockReset();
  sessionStorage.clear();
});

describe("InviteAcceptScreen", () => {
  it("토큰으로 수락 API를 호출하고 성공 메시지를 보여준다", async () => {
    mockAcceptInvitation.mockResolvedValue(undefined);

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("프로젝트에 참여했습니다.")).toBeInTheDocument();
    expect(mockAcceptInvitation).toHaveBeenCalledWith("AQ28CU79");
  });

  it("대시보드로 이동 버튼을 누르면 /dashboard로 이동한다", async () => {
    mockAcceptInvitation.mockResolvedValue(undefined);
    renderAt("/invite/AQ28CU79");
    await screen.findByText("프로젝트에 참여했습니다.");

    await userEvent.click(screen.getByRole("button", { name: "대시보드로 이동" }));

    expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("이미 처리된 초대면 에러 메시지를 보여준다", async () => {
    mockAcceptInvitation.mockRejectedValue(new Error("이미 처리된 초대입니다."));
    mockJoinProjectByCode.mockRejectedValue(new Error("유효하지 않은 초대 코드입니다."));

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("이미 처리된 초대입니다.")).toBeInTheDocument();
  });

  it("이메일 초대 토큰이 아니면 프로젝트 참여 코드로 재시도해 참여를 완료한다", async () => {
    mockAcceptInvitation.mockRejectedValue(new Error("초대를 찾을 수 없습니다."));
    mockJoinProjectByCode.mockResolvedValue({ id: 1 });

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("프로젝트에 참여했습니다.")).toBeInTheDocument();
    expect(mockJoinProjectByCode).toHaveBeenCalledWith("AQ28CU79");
  });

  it("마운트 시 pendingInvite sessionStorage 값을 정리한다", async () => {
    sessionStorage.setItem("pendingInvite", "/invite/AQ28CU79");
    mockAcceptInvitation.mockResolvedValue(undefined);

    renderAt("/invite/AQ28CU79");
    await screen.findByText("프로젝트에 참여했습니다.");

    expect(sessionStorage.getItem("pendingInvite")).toBeNull();
  });
});
