import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BoardView } from "./BoardView";
import { fetchTasks } from "../libs/utils/taskApi";
import type { Task } from "../libs/types/task";

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

function renderBoard(initialEntry = "/board") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BoardView />
    </MemoryRouter>
  );
}

function BoardWithDeepLinkTrigger() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/board?taskId=42")}>업무 알림 열기</button>
      <BoardView />
    </>
  );
}

describe("BoardView - 프로젝트 컨텍스트 준비 전 조회 방지", () => {
  beforeEach(() => {
    vi.mocked(fetchTasks).mockReset().mockResolvedValue([]);
  });

  it("taskId 딥링크의 업무가 로드되면 상세 패널을 자동으로 연다", async () => {
    const task: Task = {
      id: "42", title: "알림으로 연 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { role: "팀장" },
      projectContextReady: true,
    });

    renderBoard("/board?taskId=42&priority=high");

    await waitFor(() => {
      expect(screen.getAllByText("알림으로 연 업무").length).toBeGreaterThan(1);
    });
  });

  it("업무보드가 이미 열린 상태에서도 URL taskId 변경을 감지해 상세 패널을 연다", async () => {
    const task: Task = {
      id: "42", title: "보드 내부 알림 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { role: "팀장" },
      projectContextReady: true,
    });

    render(
      <MemoryRouter initialEntries={["/board"]}>
        <BoardWithDeepLinkTrigger />
      </MemoryRouter>
    );
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledWith(20));
    expect(screen.getAllByText("보드 내부 알림 업무")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "업무 알림 열기" }));

    await waitFor(() => {
      expect(screen.getAllByText("보드 내부 알림 업무").length).toBeGreaterThan(1);
    });
  });

  it("taskId에 해당하는 업무가 없으면 삭제·누락 안내를 표시한다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { role: "팀장" },
      projectContextReady: true,
    });

    renderBoard("/board?taskId=999");

    expect(await screen.findByText("삭제되었거나 현재 프로젝트에서 찾을 수 없는 업무입니다.")).toBeInTheDocument();
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
