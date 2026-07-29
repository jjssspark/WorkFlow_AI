import { act, render, screen, waitFor } from "@testing-library/react";
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

type TaskMoveHandler = (
  event: { taskId: string; projectId: string; status: string; position: number; version: number }
) => void;
let capturedTaskMoveHandler: TaskMoveHandler | null = null;
const mockSubscribeTaskMove = vi.fn((handler: TaskMoveHandler) => {
  capturedTaskMoveHandler = handler;
  return () => {
    capturedTaskMoveHandler = null;
  };
});
let mockIsStreamConnected = false;
vi.mock("../../global/hooks/useNotifications", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    refreshUnreadCount: vi.fn(),
    subscribeTaskMove: mockSubscribeTaskMove,
    isStreamConnected: mockIsStreamConnected,
  }),
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
    mockSubscribeTaskMove.mockClear();
    capturedTaskMoveHandler = null;
    mockIsStreamConnected = false;
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

describe("BoardView - 실시간 동기화", () => {
  beforeEach(() => {
    vi.mocked(fetchTasks).mockReset().mockResolvedValue([]);
    mockSubscribeTaskMove.mockClear();
    capturedTaskMoveHandler = null;
    mockIsStreamConnected = false;
  });

  // KanbanColumn은 컬럼 헤더에 label(예: "할 일")과 그 옆에 카드 개수 배지(<span>)를 렌더링한다
  // (App/frontend/src/board/components/KanbanColumn.tsx:51-60). data-testid가 없으므로, 컬럼 label
  // 바로 다음에 오는 마지막 span(개수 배지)의 텍스트로 "그 컬럼에 카드가 몇 개인가"를 확인한다.
  function countBadgeFor(columnLabel: string): string | null {
    const label = screen.getByText(columnLabel);
    return label.parentElement?.querySelector("span:last-of-type")?.textContent ?? null;
  }

  it("같은 프로젝트의 task-move 이벤트를 받으면 보드 상태를 patch한다", async () => {
    const task: Task = {
      id: "42", title: "동기화 대상 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    renderBoard();
    await waitFor(() => expect(mockSubscribeTaskMove).toHaveBeenCalled());
    await screen.findByText("동기화 대상 업무");
    expect(countBadgeFor("할 일")).toBe("1");
    expect(countBadgeFor("진행 중")).toBe("0");

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "inprogress", position: 1, version: 100 });
    });

    await waitFor(() => {
      expect(countBadgeFor("할 일")).toBe("0");
      expect(countBadgeFor("진행 중")).toBe("1");
    });
  });

  it("같은 업무에 대해 더 오래된 version의 이벤트가 나중에 도착하면 무시한다", async () => {
    // 두 사용자가 같은 업무를 거의 동시에 옮기면, 커밋은 잠금으로 순서가 보장돼도 브로드캐스트가
    // 도착하는 순서는 스레드 스케줄링에 달려 있어 최신 이벤트보다 오래된 이벤트가 나중에 올 수 있다.
    // 이 테스트가 없으면 version 비교 없이 "마지막에 온 걸 그대로 반영"하는 회귀가 안 잡힌다.
    const task: Task = {
      id: "42", title: "동기화 대상 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    renderBoard();
    await waitFor(() => expect(mockSubscribeTaskMove).toHaveBeenCalled());
    await screen.findByText("동기화 대상 업무");

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "inprogress", position: 1, version: 200 });
    });
    await waitFor(() => expect(countBadgeFor("진행 중")).toBe("1"));

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "todo", position: 2, version: 100 });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(countBadgeFor("진행 중")).toBe("1");
    expect(countBadgeFor("할 일")).toBe("0");
  });

  it("같은 version(동률)의 이벤트가 도착하면 폐기하지 않고 반영한다", async () => {
    // version은 Task.moveVersion(칸반 이동마다 DB에서 1씩 증가하는 정수 카운터)이라 서로 다른
    // 두 커밋이 동률일 수는 없다 - 동률은 항상 같은 이벤트의 재전송(예: 재연결 시 중복 수신)을
    // 뜻한다. "<="로 동률까지 버리면, 그 재전송된(=이미 반영된 것과 같은) 최신 이벤트가 조용히
    // 폐기돼도 상태 자체는 이미 맞으므로 문제가 되진 않지만, 이 테스트는 "동률은 버리지 않고
    // 그대로 적용해도 안전하다"는 계약을 고정해 둔다.
    const task: Task = {
      id: "42", title: "동기화 대상 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    renderBoard();
    await waitFor(() => expect(mockSubscribeTaskMove).toHaveBeenCalled());
    await screen.findByText("동기화 대상 업무");

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "inprogress", position: 1, version: 200 });
    });
    await waitFor(() => expect(countBadgeFor("진행 중")).toBe("1"));

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "blocked", position: 2, version: 200 });
    });

    await waitFor(() => {
      expect(countBadgeFor("보류/블로커")).toBe("1");
      expect(countBadgeFor("진행 중")).toBe("0");
    });
  });

  it("알 수 없는 status 값의 task-move 이벤트는 무시한다", async () => {
    const task: Task = {
      id: "42", title: "동기화 대상 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    renderBoard();
    await waitFor(() => expect(mockSubscribeTaskMove).toHaveBeenCalled());
    await screen.findByText("동기화 대상 업무");

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "20", status: "archived", position: 1, version: 100 });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(countBadgeFor("할 일")).toBe("1");
  });

  it("다른 프로젝트의 task-move 이벤트는 무시한다", async () => {
    const task: Task = {
      id: "42", title: "다른 프로젝트 업무", status: "todo", priority: "medium",
      assignee: "", startDate: "", dueDate: "", labels: [], category: "backend",
      position: 0, pendingApproval: false, extraFields: {},
    };
    vi.mocked(fetchTasks).mockResolvedValue([task]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    renderBoard();
    await waitFor(() => expect(mockSubscribeTaskMove).toHaveBeenCalled());
    await screen.findByText("다른 프로젝트 업무");

    act(() => {
      capturedTaskMoveHandler!({ taskId: "42", projectId: "999", status: "inprogress", position: 1, version: 100 });
    });

    // 무시됐다는 것은 "아무 일도 안 일어난다"는 것이라 await로 기다릴 조건이 없다 - 짧게 한 틱
    // 양보한 뒤 컬럼 배지가 그대로인지 확인한다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countBadgeFor("할 일")).toBe("1");
    expect(countBadgeFor("진행 중")).toBe("0");
  });

  it("SSE 재연결(false→true 전이) 시 업무 목록을 다시 불러온다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    const { rerender } = renderBoard();
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(1));

    mockIsStreamConnected = true;
    rerender(
      <MemoryRouter initialEntries={["/board"]}>
        <BoardView />
      </MemoryRouter>
    );
    // 최초 연결(첫 true 전이)은 재연결이 아니므로 재조회하지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchTasks).toHaveBeenCalledTimes(1);

    mockIsStreamConnected = false;
    rerender(
      <MemoryRouter initialEntries={["/board"]}>
        <BoardView />
      </MemoryRouter>
    );
    mockIsStreamConnected = true;
    rerender(
      <MemoryRouter initialEntries={["/board"]}>
        <BoardView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2));
  });

  it("연결된 상태를 유지한 채 프로젝트만 전환하면(재연결 아님) 재조회는 프로젝트 전환분 한 번만 일어난다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    mockIsStreamConnected = true;
    mockUseAuth.mockReturnValue({ currentProjectId: 20, currentProject: { role: "팀장" }, projectContextReady: true });

    const { rerender } = renderBoard();
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(1));

    // isStreamConnected는 true인 채로 계속 유지되고(한 번도 false로 전이하지 않음), 프로젝트만 바뀐다.
    mockUseAuth.mockReturnValue({ currentProjectId: 21, currentProject: { role: "팀장" }, projectContextReady: true });
    rerender(
      <MemoryRouter initialEntries={["/board"]}>
        <BoardView />
      </MemoryRouter>
    );

    // 새 프로젝트에 대한 마운트성 재조회 1회만 있어야 하고(총 2회), 재연결로 오인한 추가 재조회(총 3회)는
    // 없어야 한다.
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchTasks).toHaveBeenCalledTimes(2);
  });
});
