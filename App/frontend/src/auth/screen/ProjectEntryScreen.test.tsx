import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectEntryScreen } from "./ProjectEntryScreen";
import { ApiRequestError } from "../../global/api/apiClient";

const mockAcceptInvitation = vi.hoisted(() => vi.fn());
const mockJoinProjectByCode = vi.hoisted(() => vi.fn());
const mockListProjects = vi.hoisted(() => vi.fn());
vi.mock("../../global/api/projectsApi", () => ({
  acceptInvitation: mockAcceptInvitation,
  joinProjectByCode: mockJoinProjectByCode,
  listProjects: mockListProjects,
}));

const mockSelectProject = vi.hoisted(() => vi.fn());
const mockRefreshMe = vi.hoisted(() => vi.fn());
const mockAddLocalProjectRole = vi.hoisted(() => vi.fn());
const existingProjectRoles = [{ projectId: 1, projectTitle: "기존 프로젝트", role: "팀원" as const }];
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "허영주" },
    projectRoles: existingProjectRoles,
    currentProject: null,
    selectProject: mockSelectProject,
    addLocalProjectRole: mockAddLocalProjectRole,
    refreshMe: mockRefreshMe,
    logout: vi.fn(),
  }),
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <ProjectEntryScreen />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAcceptInvitation.mockReset();
  mockJoinProjectByCode.mockReset();
  mockListProjects.mockReset();
  mockSelectProject.mockReset();
  mockRefreshMe.mockReset();
  mockAddLocalProjectRole.mockReset();
  mockNavigate.mockReset();
});

describe("ProjectEntryScreen 초대 URL/코드 입력", () => {
  it("링크 복사로 받은 토큰을 붙여넣으면 acceptInvitation으로 수락하고 새로 들어간 프로젝트를 선택한다", async () => {
    mockAcceptInvitation.mockResolvedValue(undefined);
    mockRefreshMe.mockResolvedValue({
      user: { id: 1, name: "허영주" },
      projectRoles: [
        ...existingProjectRoles,
        { projectId: 26, projectTitle: "초대기능 테스트 프로젝트", role: "팀원" as const },
      ],
    });

    renderScreen();
    await userEvent.type(
      screen.getByPlaceholderText("예: https://teamflow.ai/invite/gX4mKp 또는 gX4mKp"),
      "https://teamflow.ai/invite/d5133a86-789f-4296-ba6e-a020638f48a6"
    );
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    await vi.waitFor(() => expect(mockAcceptInvitation).toHaveBeenCalledWith("d5133a86-789f-4296-ba6e-a020638f48a6"));
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
    expect(mockSelectProject).toHaveBeenCalledWith(26);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("토큰이 아닌 프로젝트 코드는 INVITE_NOT_FOUND일 때만 joinProjectByCode로 폴백한다", async () => {
    mockAcceptInvitation.mockRejectedValue(new ApiRequestError("초대를 찾을 수 없습니다.", 404, "INVITE_NOT_FOUND"));
    mockJoinProjectByCode.mockResolvedValue({ id: 26 });
    mockRefreshMe.mockResolvedValue({
      user: { id: 1, name: "허영주" },
      projectRoles: [
        ...existingProjectRoles,
        { projectId: 26, projectTitle: "초대기능 테스트 프로젝트", role: "팀원" as const },
      ],
    });

    renderScreen();
    await userEvent.type(screen.getByPlaceholderText("예: https://teamflow.ai/invite/gX4mKp 또는 gX4mKp"), "gX4mKp");
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    await vi.waitFor(() => expect(mockJoinProjectByCode).toHaveBeenCalledWith("gX4mKp"));
    expect(mockSelectProject).toHaveBeenCalledWith(26);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("이미 처리된 초대 등 다른 실패는 폴백 없이 에러를 그대로 보여준다", async () => {
    mockAcceptInvitation.mockRejectedValue(
      new ApiRequestError("이미 처리된 초대입니다.", 409, "INVITE_ALREADY_PROCESSED")
    );

    renderScreen();
    await userEvent.type(
      screen.getByPlaceholderText("예: https://teamflow.ai/invite/gX4mKp 또는 gX4mKp"),
      "d5133a86-789f-4296-ba6e-a020638f48a6"
    );
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    expect(await screen.findByText("이미 처리된 초대입니다.")).toBeInTheDocument();
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("입력값이 비어있으면 API를 호출하지 않고 안내 문구를 보여준다", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    expect(await screen.findByText("초대 URL 또는 코드를 입력해주세요.")).toBeInTheDocument();
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
    expect(mockJoinProjectByCode).not.toHaveBeenCalled();
  });
});
