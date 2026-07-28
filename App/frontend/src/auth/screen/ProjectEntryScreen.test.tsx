import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectEntryScreen } from "./ProjectEntryScreen";
import { listProjects } from "../../global/api/projectsApi";
import {
  fetchReviewerActivities, fetchReviewerLastAccess, recordReviewerAccess,
} from "../../global/api/reviewerActivityApi";

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const selectProject = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../../global/api/projectsApi", () => ({
  listProjects: vi.fn(),
  joinProjectByCode: vi.fn(),
}));

vi.mock("../../global/api/reviewerActivityApi", () => ({
  fetchReviewerActivities: vi.fn(),
  fetchReviewerLastAccess: vi.fn(),
  recordReviewerAccess: vi.fn(),
}));

function projectResponse(id: number, title: string) {
  return {
    id, title, type: null, deadline: null, description: null, startDate: null, midCheckDate: null,
    memberLimit: null, deliverables: null, techStack: null, goals: null, inviteCode: null,
    createdBy: null, memberCount: 3, taskProgress: 40, evalStatus: "EVALUATING",
  };
}

function renderJudgeHome() {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <ProjectEntryScreen />
    </MemoryRouter>
  );
}

describe("심사자 홈 - 최근 심사 활동", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: "심사자" },
      projectRoles: [{ projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "심사자" }],
      currentProject: { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "심사자" },
      selectProject, addLocalProjectRole: vi.fn(), refreshMe: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(recordReviewerAccess).mockResolvedValue(null);
    vi.mocked(fetchReviewerLastAccess).mockResolvedValue([]);
  });

  it("활동 문구와 프로젝트명, 실제 활동 날짜를 표시한다", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue([{
      id: "100", projectTitle: "스마트 주차 관리 시스템",
      message: "평가 확정", createdAt: "2026-07-28T09:30:00.000Z",
    }]);

    renderJudgeHome();

    expect(await screen.findByText("평가 확정")).toBeInTheDocument();
    expect(screen.getByText("스마트 주차 관리 시스템 · 07.28")).toBeInTheDocument();
  });

  it("활동 기록이 없으면 빈 상태 문구를 보여준다", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue([]);

    renderJudgeHome();

    expect(await screen.findByText("아직 심사 활동이 없습니다.")).toBeInTheDocument();
  });

  it("최근 접속한 프로젝트가 목록 맨 위로 온다", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectResponse(1, "먼저 접속한 프로젝트"),
      projectResponse(2, "나중에 접속한 프로젝트"),
    ]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue([]);
    vi.mocked(fetchReviewerLastAccess).mockResolvedValue([
      { projectId: 1, lastAccessedAt: "2026-07-20T10:00:00.000Z" },
      { projectId: 2, lastAccessedAt: "2026-07-27T10:00:00.000Z" },
    ]);

    renderJudgeHome();

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
    vi.mocked(fetchReviewerActivities).mockResolvedValue([]);
    vi.mocked(fetchReviewerLastAccess).mockResolvedValue([
      { projectId: 2, lastAccessedAt: "2026-07-27T10:00:00.000Z" },
    ]);

    renderJudgeHome();

    await screen.findByText("접속한 프로젝트");
    expect(screen.getByText("접속한 적 없는 프로젝트")).toBeInTheDocument();
  });

  it("프로젝트에 진입하면 접속을 기록한다", async () => {
    vi.mocked(listProjects).mockResolvedValue([projectResponse(7, "심사 프로젝트")]);
    vi.mocked(fetchReviewerActivities).mockResolvedValue([]);

    renderJudgeHome();

    await userEvent.click(await screen.findByText("심사 프로젝트"));

    await waitFor(() => expect(recordReviewerAccess).toHaveBeenCalledWith(7));
    expect(selectProject).toHaveBeenCalledWith(7);
  });

  /** 활동 조회 실패가 홈 전체를 막으면 안 된다 — 배정 프로젝트 목록은 계속 보여야 한다. */
  it("활동 조회에 실패해도 배정 프로젝트 목록은 그대로 보인다", async () => {
    vi.mocked(listProjects).mockResolvedValue([projectResponse(1, "심사 프로젝트")]);
    vi.mocked(fetchReviewerActivities).mockRejectedValue(new Error("network error"));

    renderJudgeHome();

    expect(await screen.findByText("심사 프로젝트")).toBeInTheDocument();
    expect(screen.getByText("아직 심사 활동이 없습니다.")).toBeInTheDocument();
  });
});
