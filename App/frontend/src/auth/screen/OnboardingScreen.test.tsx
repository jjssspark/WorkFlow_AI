import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingScreen } from "./OnboardingScreen";
import { listProjects } from "../../global/api/projectsApi";
import type { ProjectResponse } from "../../global/api/projectsApi";

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockRefreshMe = vi.fn();
const mockSelectProject = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "테스트유저" },
    refreshMe: mockRefreshMe,
    selectProject: mockSelectProject,
  }),
}));

vi.mock("../../global/api/projectsApi", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  createInvitation: vi.fn(),
}));

function projectResponse(type: string): ProjectResponse {
  return {
    id: 1, title: "이전 프로젝트", type, year: 2026, deadline: null, description: null,
    startDate: null, midCheckDate: null, memberLimit: null, deliverables: null, techStack: null,
    goals: null, inviteCode: null, createdBy: null, memberCount: 1, taskProgress: 0, evalStatus: "PENDING",
  };
}

function renderOnboarding() {
  render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <OnboardingScreen />
    </MemoryRouter>
  );
}

describe("OnboardingScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("진행 연도 입력란은 현재 연도를 기본값으로 가진다", () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    renderOnboarding();

    const currentYear = new Date().getFullYear();
    expect(screen.getByDisplayValue(String(currentYear))).toBeInTheDocument();
  });

  it("가장 최근 프로젝트(목록 첫 번째)의 유형을 프리셋으로 선택한다", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      projectResponse("해커톤"),
      projectResponse("공모전"),
    ]);

    renderOnboarding();

    // 선택된 카드만 "border-border" 기본 테두리 클래스가 빠지고 강조 스타일이 적용된다.
    await waitFor(() => {
      const selectedButton = screen.getByText("해커톤").closest("button");
      expect(selectedButton?.className).not.toContain("border-border");
    });

    const notSelectedButton = screen.getByText("공모전").closest("button");
    expect(notSelectedButton?.className).toContain("border-border");
  });

  it("프리셋이 늦게 도착해도 사용자가 먼저 직접 선택한 유형을 덮어쓰지 않는다", async () => {
    let resolveListProjects: (projects: ProjectResponse[]) => void = () => {};
    const pendingListProjects = new Promise<ProjectResponse[]>((resolve) => {
      resolveListProjects = resolve;
    });
    vi.mocked(listProjects).mockReturnValue(pendingListProjects);

    renderOnboarding();

    // 프리셋(listProjects)이 아직 응답하기 전에 사용자가 직접 유형을 선택한다.
    await userEvent.click(screen.getByText("공모전"));
    expect(screen.getByText("공모전").closest("button")?.className).not.toContain("border-border");

    // 뒤늦게 도착한 프리셋 응답이 다른 유형을 가리키더라도 사용자의 선택을 덮어쓰면 안 된다.
    resolveListProjects([projectResponse("해커톤")]);
    await waitFor(() => expect(listProjects).toHaveBeenCalled());

    expect(screen.getByText("공모전").closest("button")?.className).not.toContain("border-border");
    expect(screen.getByText("해커톤").closest("button")?.className).toContain("border-border");
  });
});
