import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectEntryScreen } from "./ProjectEntryScreen";
import { ApiRequestError } from "../../global/api/apiClient";
import { acceptInvitation, joinProjectByCode, listProjects } from "../../global/api/projectsApi";
import { fetchReviewerActivities, recordReviewerAccess } from "../../global/api/reviewerActivityApi";

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const selectProject = vi.fn();
const refreshMe = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../../global/api/projectsApi", () => ({
  acceptInvitation: vi.fn(),
  joinProjectByCode: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../../global/api/reviewerActivityApi", () => ({
  fetchReviewerActivities: vi.fn(),
  recordReviewerAccess: vi.fn(),
}));

function projectResponse(id: number, title: string) {
  return {
    id, title, type: null, deadline: null, description: null, startDate: null, midCheckDate: null,
    memberLimit: null, deliverables: null, techStack: null, goals: null, inviteCode: null,
    createdBy: null, memberCount: 3, taskProgress: 40, evalStatus: "EVALUATING",
  };
}

function renderScreen() {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <ProjectEntryScreen />
    </MemoryRouter>
  );
}

const INVITE_PLACEHOLDER = "예: https://teamflow.ai/invite/gX4mKp 또는 gX4mKp";

describe("ProjectEntryScreen 초대 URL/코드 입력", () => {
  const existingProjectRoles = [{ projectId: 1, projectTitle: "기존 프로젝트", role: "팀원" as const }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: "허영주" },
      projectRoles: existingProjectRoles,
      currentProject: null,
      selectProject,
      addLocalProjectRole: vi.fn(),
      refreshMe,
      logout: vi.fn(),
    });
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({ activities: [], lastAccess: [] });
  });

  function refreshMeWithJoinedProject() {
    refreshMe.mockResolvedValue({
      user: { id: 1, name: "허영주" },
      projectRoles: [
        ...existingProjectRoles,
        { projectId: 26, projectTitle: "초대기능 테스트 프로젝트", role: "팀원" as const },
      ],
    });
  }

  it("링크 복사로 받은 토큰을 붙여넣으면 acceptInvitation으로 수락하고 서버가 알려준 프로젝트를 선택한다", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ projectId: 26 });
    refreshMeWithJoinedProject();

    renderScreen();
    await userEvent.type(
      screen.getByPlaceholderText(INVITE_PLACEHOLDER),
      "https://teamflow.ai/invite/d5133a86-789f-4296-ba6e-a020638f48a6"
    );
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith("d5133a86-789f-4296-ba6e-a020638f48a6"));
    expect(joinProjectByCode).not.toHaveBeenCalled();
    expect(selectProject).toHaveBeenCalledWith(26);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  /**
   * 예전에는 갱신 전후 프로젝트 목록을 비교해 "새로 생긴 항목"을 참여한 프로젝트로 추측했다.
   * 이미 그 프로젝트 멤버인 사람이 링크를 다시 쓰면 새 항목이 없어 아무것도 선택되지 않은 채
   * 대시보드로 넘어갔다 - 서버가 준 id를 그대로 쓰면 이 경우도 정상 동작한다.
   */
  it("이미 멤버인 프로젝트에 다시 참여해도 해당 프로젝트를 선택한다", async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ projectId: 1 });
    refreshMe.mockResolvedValue({
      user: { id: 1, name: "허영주" },
      projectRoles: existingProjectRoles,
    });

    renderScreen();
    await userEvent.type(
      screen.getByPlaceholderText(INVITE_PLACEHOLDER),
      "d5133a86-789f-4296-ba6e-a020638f48a6"
    );
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    await waitFor(() => expect(selectProject).toHaveBeenCalledWith(1));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("토큰이 아닌 프로젝트 코드는 INVITE_NOT_FOUND일 때만 joinProjectByCode로 폴백한다", async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(
      new ApiRequestError("초대를 찾을 수 없습니다.", 404, "INVITE_NOT_FOUND")
    );
    vi.mocked(joinProjectByCode).mockResolvedValue(projectResponse(26, "초대기능 테스트 프로젝트"));
    refreshMeWithJoinedProject();

    renderScreen();
    await userEvent.type(screen.getByPlaceholderText(INVITE_PLACEHOLDER), "gX4mKp");
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    await waitFor(() => expect(joinProjectByCode).toHaveBeenCalledWith("gX4mKp"));
    expect(selectProject).toHaveBeenCalledWith(26);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("이미 처리된 초대 등 다른 실패는 폴백 없이 에러를 그대로 보여준다", async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(
      new ApiRequestError("이미 처리된 초대입니다.", 409, "INVITE_ALREADY_PROCESSED")
    );

    renderScreen();
    await userEvent.type(
      screen.getByPlaceholderText(INVITE_PLACEHOLDER),
      "d5133a86-789f-4296-ba6e-a020638f48a6"
    );
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    expect(await screen.findByText("이미 처리된 초대입니다.")).toBeInTheDocument();
    expect(joinProjectByCode).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("입력값이 비어있으면 API를 호출하지 않고 안내 문구를 보여준다", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "팀원으로 참여" }));

    expect(await screen.findByText("초대 URL 또는 코드를 입력해주세요.")).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
    expect(joinProjectByCode).not.toHaveBeenCalled();
  });
});

describe("심사자 홈 - 최근 심사 활동", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: "심사자" },
      projectRoles: [{ projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "심사자" }],
      currentProject: { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "심사자" },
      selectProject, addLocalProjectRole: vi.fn(), refreshMe, logout: vi.fn(),
    });
    vi.mocked(recordReviewerAccess).mockResolvedValue(null);
  });

  it("활동 문구와 프로젝트명, 실제 활동 날짜를 표시한다", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({
      activities: [{
        projectId: 1, projectTitle: "스마트 주차 관리 시스템", activityType: "EVALUATION_FINALIZED",
        activityLabel: "평가 확정", createdAt: "2026-07-28T09:30:00",
      }],
      lastAccess: [],
    });

    renderScreen();

    expect(await screen.findByText("평가 확정")).toBeInTheDocument();
    expect(screen.getByText("스마트 주차 관리 시스템 · 7.28")).toBeInTheDocument();
  });

  it("활동 기록이 없으면 빈 상태 문구를 보여준다", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({ activities: [], lastAccess: [] });

    renderScreen();

    expect(await screen.findByText("아직 심사 활동 기록이 없습니다.")).toBeInTheDocument();
  });

  it("최근 접속한 프로젝트가 목록 맨 위로 온다", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectResponse(1, "먼저 접속한 프로젝트"),
      projectResponse(2, "나중에 접속한 프로젝트"),
    ]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({
      activities: [],
      lastAccess: [
        { projectId: 1, lastAccessedAt: "2026-07-20T10:00:00" },
        { projectId: 2, lastAccessedAt: "2026-07-27T10:00:00" },
      ],
    });

    renderScreen();

    await screen.findByText("나중에 접속한 프로젝트");
    const titles = screen.getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
      .filter((text) => text?.includes("접속한 프로젝트"));
    expect(titles[0]).toBe("나중에 접속한 프로젝트");
    expect(titles[1]).toBe("먼저 접속한 프로젝트");
  });

  /** 아직 한 번도 열어보지 않은 배정 프로젝트가 목록에서 사라지면 안 된다. */
  it("접속 기록이 없는 프로젝트도 뒤쪽에 그대로 남는다", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectResponse(1, "접속한 적 없는 프로젝트"),
      projectResponse(2, "접속한 프로젝트"),
    ]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({
      activities: [],
      lastAccess: [{ projectId: 2, lastAccessedAt: "2026-07-27T10:00:00" }],
    });

    renderScreen();

    await screen.findByText("접속한 프로젝트");
    expect(screen.getByText("접속한 적 없는 프로젝트")).toBeInTheDocument();
  });

  it("프로젝트에 진입하면 접속을 기록한다", async () => {
    vi.mocked(listProjects).mockResolvedValue([projectResponse(7, "심사 프로젝트")]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue({ activities: [], lastAccess: [] });

    renderScreen();

    await userEvent.click(await screen.findByText("심사 프로젝트"));

    await waitFor(() => expect(recordReviewerAccess).toHaveBeenCalledWith(7));
    expect(selectProject).toHaveBeenCalledWith(7);
  });

  /** 활동 조회 실패가 홈 전체를 막으면 안 된다 — 배정 프로젝트 목록은 계속 보여야 한다. */
  it("활동 조회에 실패해도 배정 프로젝트 목록은 그대로 보인다", async () => {
    vi.mocked(listProjects).mockResolvedValue([projectResponse(1, "심사 프로젝트")]);
    vi.mocked(fetchReviewerActivities).mockRejectedValue(new Error("network error"));

    renderScreen();

    expect(await screen.findByText("심사 프로젝트")).toBeInTheDocument();
    expect(screen.getByText("아직 심사 활동 기록이 없습니다.")).toBeInTheDocument();
  });
});
