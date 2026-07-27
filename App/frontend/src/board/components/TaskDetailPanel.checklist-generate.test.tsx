import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailPanel } from "./TaskDetailPanel";
import type { Task } from "../libs/types/task";
import { generateChecklistPreview, applyGeneratedChecklist } from "../libs/utils/checklistApi";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({ currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" } }),
}));

vi.mock("../libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn().mockResolvedValue([{ id: "1", label: "기존 항목", done: false }]),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  generateChecklistPreview: vi.fn().mockResolvedValue({ titles: ["API 설계", "구현"], engine: "ollama" }),
  applyGeneratedChecklist: vi.fn().mockResolvedValue([{ id: "9", label: "API 설계", done: false }]),
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

function makeTask(): Task {
  return {
    id: "TF-01", title: "테스트 업무", status: "todo", priority: "medium",
    assignee: "1", dueDate: "2026-07-20", labels: [], category: "backend", position: 0, pendingApproval: false, startDate: "", extraFields: {},
  };
}

describe("TaskDetailPanel 체크리스트 자동 생성", () => {
  it("opens the preview modal, shows generated titles, and applies the selected items", async () => {
    const onShowToast = vi.fn();
    render(
      <TaskDetailPanel
        task={makeTask()}
        projectMembers={[]}
        onClose={vi.fn()}
        onQuickAction={vi.fn()}
        onShowToast={onShowToast}
        onDeleteTask={vi.fn()}
        onEditTask={vi.fn()}
        onOpenWorkResult={vi.fn()}
        onCancelCompletionRequest={vi.fn()}
      />
    );

    expect(await screen.findByText("기존 항목")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("더보기"));
    await userEvent.click(await screen.findByText("체크리스트 자동 생성"));

    expect(generateChecklistPreview).toHaveBeenCalledWith("TF-01", 1);
    expect(await screen.findByDisplayValue("API 설계")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("구현")).toBeInTheDocument();
    expect(screen.getByText("기존 항목")).toBeInTheDocument();

    await userEvent.click(screen.getByText("선택 항목 추가"));

    expect(applyGeneratedChecklist).toHaveBeenCalledWith("TF-01", ["API 설계", "구현"], 1);
    await waitFor(() => {
      expect(onShowToast).toHaveBeenCalledWith("체크리스트 1개를 추가했습니다.");
    });
  });
});
