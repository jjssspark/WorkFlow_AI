import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../global/api/apiClient";
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

  it("이미 처리된 초대면 폴백 없이 에러 메시지를 그대로 보여준다", async () => {
    mockAcceptInvitation.mockRejectedValue(
      new ApiRequestError("이미 처리된 초대입니다.", 409, "INVITE_ALREADY_PROCESSED")
    );

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("이미 처리된 초대입니다.")).toBeInTheDocument();
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
  });

  it("네트워크 오류/5xx 등 토큰 미확인 상태가 아니면 폴백하지 않는다", async () => {
    mockAcceptInvitation.mockRejectedValue(
      new ApiRequestError("서버가 일시적으로 응답하지 않습니다.", 503, "SERVICE_UNAVAILABLE")
    );

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("서버가 일시적으로 응답하지 않습니다.")).toBeInTheDocument();
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
  });

  it("일반 네트워크 오류(ApiRequestError가 아님)에도 폴백하지 않는다", async () => {
    mockAcceptInvitation.mockRejectedValue(new TypeError("Failed to fetch"));

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
  });

  it("초대 토큰을 찾지 못한 경우(INVITE_NOT_FOUND)에만 프로젝트 참여 코드로 재시도해 참여를 완료한다", async () => {
    mockAcceptInvitation.mockRejectedValue(
      new ApiRequestError("초대를 찾을 수 없습니다.", 404, "INVITE_NOT_FOUND")
    );
    mockJoinProjectByCode.mockResolvedValue({ id: 1 });

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("프로젝트에 참여했습니다.")).toBeInTheDocument();
    expect(mockJoinProjectByCode).toHaveBeenCalledWith("AQ28CU79");
  });

  it("폴백(참여 코드)까지 실패하면 폴백의 실제 에러 메시지를 보여준다", async () => {
    mockAcceptInvitation.mockRejectedValue(
      new ApiRequestError("초대를 찾을 수 없습니다.", 404, "INVITE_NOT_FOUND")
    );
    mockJoinProjectByCode.mockRejectedValue(
      new ApiRequestError("유효하지 않은 초대 코드입니다.", 400, "INVALID_INVITE_CODE")
    );

    renderAt("/invite/AQ28CU79");

    expect(await screen.findByText("유효하지 않은 초대 코드입니다.")).toBeInTheDocument();
  });

  it("마운트 시 pendingInvite sessionStorage 값을 정리한다", async () => {
    sessionStorage.setItem("pendingInvite", "/invite/AQ28CU79");
    mockAcceptInvitation.mockResolvedValue(undefined);

    renderAt("/invite/AQ28CU79");
    await screen.findByText("프로젝트에 참여했습니다.");

    expect(sessionStorage.getItem("pendingInvite")).toBeNull();
  });
});
