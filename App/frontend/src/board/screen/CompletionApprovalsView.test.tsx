import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import { CompletionApprovalsView } from "./CompletionApprovalsView";
import { fetchPendingApprovalTasks, approveTaskCompletion, rejectTaskCompletion } from "../libs/utils/taskApi";
import { fetchChecklist } from "../libs/utils/checklistApi";
import { getProjectMembers } from "../../global/api/projectsApi";
import type { Task } from "../libs/types/task";
import {
  PENDING_APPROVAL_COUNT_CHANGED,
  type PendingApprovalCountDetail,
} from "../../leader/libs/utils/pendingApprovalEvents";

vi.mock("../libs/utils/taskApi", async () => {
  const actual = await vi.importActual<typeof import("../libs/utils/taskApi")>("../libs/utils/taskApi");
  return {
    ...actual,
    fetchPendingApprovalTasks: vi.fn(),
    approveTaskCompletion: vi.fn(),
    rejectTaskCompletion: vi.fn(),
    cancelTaskCompletion: vi.fn(),
    updateTaskPosition: vi.fn(),
    deleteTask: vi.fn(),
  };
});

vi.mock("../libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn(),
}));

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn(),
  getProject: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    currentProjectId: 1,
    currentProject: { role: "팀장" },
    user: { id: 1, name: "허영주" },
    projectContextReady: true,
  }),
}));

// TaskDetailPanel은 자체적으로 코멘트/체크리스트 API를 여러 번 호출하므로
// 이 화면 테스트에서는 목록/필터/처리 동작만 검증하고 상세 패널은 목킹한다.
vi.mock("../components/TaskDetailPanel", () => ({
  TaskDetailPanel: ({ task }: { task: Task }) => <div data-testid="detail-panel">상세: {task.title}</div>,
}));

function makeTask(id: string, title: string, assignee: string): Task {
  return {
    id, title, status: "inprogress", priority: "medium", assignee,
    dueDate: "2026-08-01", labels: [], category: "backend", position: 0,
    pendingApproval: true, startDate: "2026-07-20", extraFields: {},
  };
}

function renderApprovals(initialEntry = "/leader/completion-approvals") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CompletionApprovalsView />
    </MemoryRouter>
  );
}

describe("CompletionApprovalsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectMembers).mockResolvedValue([
      { userId: 1, name: "허영주", email: "a@a.com", role: "팀장" },
      { userId: 2, name: "박상준", email: "b@a.com", role: "팀원" },
    ]);
    vi.mocked(fetchChecklist).mockResolvedValue([
      { id: "c1", label: "체크1", done: true },
      { id: "c2", label: "체크2", done: false },
    ]);
  });

  it("renders pending tasks as table rows with assignee, dates, and checklist progress", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([
      makeTask("T1", "결제 모듈 완료", "2"),
    ]);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("결제 모듈 완료")).toBeInTheDocument());
    expect(screen.getByRole("cell", { name: "박상준" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
  });

  it("filters rows by selected assignee", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([
      makeTask("T1", "업무A", "2"),
      makeTask("T2", "업무B", "1"),
    ]);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("업무A")).toBeInTheDocument());
    expect(screen.getByText("업무B")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox"), "2");

    expect(screen.getByText("업무A")).toBeInTheDocument();
    expect(screen.queryByText("업무B")).not.toBeInTheDocument();
  });

  it("approves a task and removes it from the list", async () => {
    const publishedCounts: number[] = [];
    const handleCount = (event: Event) => {
      publishedCounts.push((event as CustomEvent<PendingApprovalCountDetail>).detail.count);
    };
    window.addEventListener(PENDING_APPROVAL_COUNT_CHANGED, handleCount);
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([makeTask("T1", "결제 모듈 완료", "2")]);
    vi.mocked(approveTaskCompletion).mockResolvedValue({} as Task);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("결제 모듈 완료")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /승인/ }));

    await waitFor(() => expect(approveTaskCompletion).toHaveBeenCalledWith("T1", 1));
    await waitFor(() => expect(screen.queryByText("결제 모듈 완료")).not.toBeInTheDocument());
    expect(publishedCounts).toEqual(expect.arrayContaining([1, 0]));
    window.removeEventListener(PENDING_APPROVAL_COUNT_CHANGED, handleCount);
  });

  it("rejects a task and removes it from the list", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([makeTask("T1", "결제 모듈 완료", "2")]);
    vi.mocked(rejectTaskCompletion).mockResolvedValue({} as Task);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("결제 모듈 완료")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /반려/ }));

    await waitFor(() => expect(rejectTaskCompletion).toHaveBeenCalledWith("T1", 1));
    await waitFor(() => expect(screen.queryByText("결제 모듈 완료")).not.toBeInTheDocument());
  });

  it("opens the detail panel when a row is clicked", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([makeTask("T1", "결제 모듈 완료", "2")]);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("결제 모듈 완료")).toBeInTheDocument());
    await userEvent.click(screen.getByText("결제 모듈 완료"));

    expect(await screen.findByTestId("detail-panel")).toHaveTextContent("결제 모듈 완료");
  });

  it("taskId 딥링크로 들어오면 해당 승인 대기 업무의 상세 패널을 연다", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([
      makeTask("T1", "다른 업무", "2"),
      makeTask("T2", "알림 대상 업무", "1"),
    ]);

    renderApprovals("/leader/completion-approvals?taskId=T2");

    expect(await screen.findByTestId("detail-panel")).toHaveTextContent("알림 대상 업무");
    expect(document.querySelector('[data-task-id="T2"]')).toHaveClass("bg-blue-50");
  });

  it("shows an empty-state message when there are no pending tasks", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([]);

    renderApprovals();

    await waitFor(() => expect(screen.getByText("승인 대기 중인 업무가 없습니다.")).toBeInTheDocument());
  });
});
