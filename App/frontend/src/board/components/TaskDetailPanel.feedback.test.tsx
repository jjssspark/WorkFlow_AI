import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TaskDetailPanel } from "./TaskDetailPanel";
import type { Task } from "../libs/types/task";

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn().mockResolvedValue([]),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  generateChecklistPreview: vi.fn().mockResolvedValue({ titles: [], engine: "ollama" }),
  applyGeneratedChecklist: vi.fn().mockResolvedValue([]),
}));

vi.mock("../libs/utils/taskCommentApi", () => ({
  fetchTaskComments: vi.fn().mockResolvedValue([]),
  createTaskComment: vi.fn().mockResolvedValue({
    id: "c1", authorId: "1", authorName: "김민준", content: "잘 진행되고 있어요", type: "FEEDBACK", createdAt: new Date().toISOString(),
  }),
  updateTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

vi.mock("../libs/utils/activityApi", () => ({
  fetchTaskActivity: vi.fn().mockResolvedValue([]),
}));

function makeTask(): Task {
  return {
    id: "TF-01", title: "테스트 업무", status: "done", priority: "medium",
    assignee: "1", dueDate: "2026-07-20", labels: [], category: "backend", position: 0, pendingApproval: false, startDate: "", extraFields: {},
  };
}

function renderPanel() {
  render(
    <TaskDetailPanel
      task={makeTask()}
      projectMembers={[]}
      onClose={vi.fn()}
      onQuickAction={vi.fn()}
      onShowToast={vi.fn()}
      onDeleteTask={vi.fn()}
      onEditTask={vi.fn()}
      onOpenWorkResult={vi.fn()}
      onCancelCompletionRequest={vi.fn()}
    />
  );
}

describe("TaskDetailPanel 팀장 피드백", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it("shows the 팀장 피드백 menu item for leaders", async () => {
    mockUseAuth.mockReturnValue({ currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" } });
    renderPanel();
    await userEvent.click(screen.getByTitle("더보기"));
    expect(await screen.findByText("팀장 피드백")).toBeInTheDocument();
  });

  it("hides the 팀장 피드백 menu item for non-leaders", async () => {
    // 담당자 본인(assignee: "1")이어야 더보기 메뉴 자체를 열 수 있다 - 그 안에서도 팀장 전용 항목은 숨겨져야 한다.
    mockUseAuth.mockReturnValue({
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" },
      user: { id: 1, name: "테스트유저" },
    });
    renderPanel();
    await userEvent.click(screen.getByTitle("더보기"));
    expect(screen.queryByText("팀장 피드백")).not.toBeInTheDocument();
  });

  it("hides the 더보기 button entirely for a team member who is not the task's assignee", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" },
      user: { id: 999, name: "다른사람" },
    });
    renderPanel();
    expect(screen.queryByTitle("더보기")).not.toBeInTheDocument();
  });

  it("switches the comment box placeholder into feedback mode when clicked", async () => {
    mockUseAuth.mockReturnValue({ currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" } });
    renderPanel();
    await userEvent.click(screen.getByTitle("더보기"));
    await userEvent.click(await screen.findByText("팀장 피드백"));
    expect(await screen.findByPlaceholderText(/팀장 피드백을 남기세요/)).toBeInTheDocument();
  });
});
