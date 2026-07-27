import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { updateChecklistItem } from "../libs/utils/checklistApi";
import type { Task, TaskStatus } from "../libs/types/task";

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn().mockResolvedValue([{ id: "c1", label: "테스트 항목", done: false }]),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn().mockResolvedValue({ id: "c1", label: "테스트 항목", done: true }),
  deleteChecklistItem: vi.fn(),
  generateChecklistPreview: vi.fn().mockResolvedValue({ titles: [], engine: "ollama" }),
  applyGeneratedChecklist: vi.fn().mockResolvedValue([]),
}));

vi.mock("../libs/utils/taskCommentApi", () => ({
  fetchTaskComments: vi.fn().mockResolvedValue([]),
  createTaskComment: vi.fn(),
  updateTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

vi.mock("../libs/utils/activityApi", () => ({
  fetchTaskActivity: vi.fn().mockResolvedValue([]),
}));

vi.mock("../libs/utils/taskApi", () => ({
  DEMO_PROJECT_ID: 1,
  sendTaskNudge: vi.fn().mockResolvedValue(undefined),
}));

function makeTask(status: TaskStatus): Task {
  return {
    id: "TF-01", title: "테스트 업무", status, priority: "medium",
    assignee: "1", dueDate: "2026-07-20", labels: [], category: "backend", position: 0, pendingApproval: false, startDate: "", extraFields: {},
  };
}

function renderPanel(status: TaskStatus) {
  const onQuickAction = vi.fn();
  render(
    <TaskDetailPanel
      task={makeTask(status)}
      projectMembers={[]}
      onClose={vi.fn()}
      onQuickAction={onQuickAction}
      onShowToast={vi.fn()}
      onDeleteTask={vi.fn()}
      onEditTask={vi.fn()}
      onOpenWorkResult={vi.fn()}
      onCancelCompletionRequest={vi.fn()}
    />
  );
  return { onQuickAction };
}

describe("체크리스트 체크 시 자동 진행중 이동", () => {
  it("담당자 본인이 todo 업무의 체크리스트를 체크하면 '진행 중으로 이동'을 트리거한다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 1 },
    });
    const { onQuickAction } = renderPanel("todo");

    const checkbox = (await screen.findByText("테스트 항목")).previousElementSibling as HTMLElement;
    await userEvent.click(checkbox);

    expect(updateChecklistItem).toHaveBeenCalledWith("TF-01", "c1", { done: true }, 1);
    expect(onQuickAction).toHaveBeenCalledWith("진행 중으로 이동", true);
  });

  it("담당자가 아니면(팀장 열람) 체크해도 자동 이동을 트리거하지 않는다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" }, user: { id: 999 },
    });
    const { onQuickAction } = renderPanel("todo");

    const checkbox = (await screen.findByText("테스트 항목")).previousElementSibling as HTMLElement;
    await userEvent.click(checkbox);

    expect(updateChecklistItem).toHaveBeenCalledWith("TF-01", "c1", { done: true }, 1);
    expect(onQuickAction).not.toHaveBeenCalled();
  });

  it("이미 진행 중인 업무는 체크해도 자동 이동을 트리거하지 않는다", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 1 },
    });
    const { onQuickAction } = renderPanel("inprogress");

    const checkbox = (await screen.findByText("테스트 항목")).previousElementSibling as HTMLElement;
    await userEvent.click(checkbox);

    expect(updateChecklistItem).toHaveBeenCalledWith("TF-01", "c1", { done: true }, 1);
    expect(onQuickAction).not.toHaveBeenCalled();
  });
});
