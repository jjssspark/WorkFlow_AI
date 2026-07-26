import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BoardView } from "./BoardView";
import { fetchTasks } from "../libs/utils/taskApi";

vi.mock("../libs/utils/taskApi", async () => {
  const actual = await vi.importActual<typeof import("../libs/utils/taskApi")>("../libs/utils/taskApi");
  return {
    ...actual,
    fetchTasks: vi.fn(),
    updateTaskPosition: vi.fn(),
    deleteTask: vi.fn(),
    requestTaskCompletion: vi.fn(),
    cancelTaskCompletion: vi.fn(),
  };
});

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn().mockResolvedValue([]),
  getProject: vi.fn().mockResolvedValue(null),
}));

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={["/board"]}>
      <BoardView />
    </MemoryRouter>
  );
}

describe("BoardView - 프로젝트 컨텍스트 준비 전 조회 방지", () => {
  beforeEach(() => {
    vi.mocked(fetchTasks).mockReset().mockResolvedValue([]);
  });

  it("projectContextReady가 false면(새로고침 직후 등) DEMO_PROJECT_ID로 폴백해 조회하지 않는다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: null,
      currentProject: null,
      projectContextReady: false,
    });

    renderBoard();

    expect(await screen.findByText("업무를 불러오는 중...")).toBeInTheDocument();
    expect(fetchTasks).not.toHaveBeenCalled();
  });

  it("projectContextReady가 true가 되고 나서야 실제 프로젝트 id로 조회한다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { role: "팀장" },
      projectContextReady: true,
    });

    renderBoard();

    await waitFor(() => expect(fetchTasks).toHaveBeenCalledWith(20));
    expect(fetchTasks).not.toHaveBeenCalledWith(1);
  });
});
