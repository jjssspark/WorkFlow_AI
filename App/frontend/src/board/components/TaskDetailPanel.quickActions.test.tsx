import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { sendTaskNudge } from "../libs/utils/taskApi";
import type { Task, TaskStatus } from "../libs/types/task";

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

function renderPanel(status: TaskStatus, overrides: Partial<Parameters<typeof TaskDetailPanel>[0]> = {}) {
  const onEditTask = vi.fn();
  const onQuickAction = vi.fn();
  const onShowToast = vi.fn();
  render(
    <TaskDetailPanel
      task={makeTask(status)}
      projectMembers={[]}
      onClose={vi.fn()}
      onQuickAction={onQuickAction}
      onShowToast={onShowToast}
      onDeleteTask={vi.fn()}
      onEditTask={onEditTask}
      onOpenWorkResult={vi.fn()}
      onCancelCompletionRequest={vi.fn()}
      {...overrides}
    />
  );
  return { onEditTask, onQuickAction, onShowToast };
}

async function openMenu() {
  await userEvent.click(screen.getByTitle("더보기"));
}

describe("TaskDetailPanel 점세개 메뉴 - 신규 구현 액션", () => {
  beforeEach(() => {
    vi.mocked(sendTaskNudge).mockClear();
    // 넛지(시작 알림 등)는 팀장 전용이라, 이 파일의 기존 테스트들이 계속 통과하도록 기본값은 팀장으로 둔다.
    mockUseAuth.mockReturnValue({ currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" } });
  });

  it("todo: 담당자 변경 클릭 시 준비중 배지 없이 onEditTask를 연다", async () => {
    const { onEditTask } = renderPanel("todo");
    await openMenu();
    const item = await screen.findByText("담당자 변경");
    expect(item.closest("button")?.textContent).not.toContain("준비 중");
    await userEvent.click(item);
    expect(onEditTask).toHaveBeenCalledTimes(1);
  });

  it("todo: 담당자 본인(팀원)에게는 담당자 변경이 보이지 않는다 - 자기 자신을 재배정할 일이 없다", async () => {
    // makeTask()의 assignee는 "1"이므로 로그인 유저 id를 1로 맞춰 담당자 본인 시나리오를 만든다.
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 1 },
    });
    renderPanel("todo");
    await openMenu();
    expect(screen.queryByText("담당자 변경")).not.toBeInTheDocument();
  });

  it("todo: 체크리스트 생성 / AI 업무 세분화는 메뉴에서 숨겨진다", async () => {
    renderPanel("todo");
    await openMenu();
    expect(screen.queryByText("체크리스트 생성")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 업무 세분화")).not.toBeInTheDocument();
  });

  it("todo: 시작 알림 클릭 시 담당자에게 알림을 보내고 토스트를 띄운다", async () => {
    const { onShowToast } = renderPanel("todo");
    await openMenu();
    const item = await screen.findByText("시작 알림");
    expect(item.closest("button")?.textContent).not.toContain("준비 중");
    await userEvent.click(item);
    await waitFor(() => expect(sendTaskNudge).toHaveBeenCalledWith("TF-01", "START", 1));
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith("시작 알림을 보냈습니다."));
  });

  it("inprogress: 블로커 등록 클릭 시 준비중 배지 없이 onQuickAction을 호출한다 (PR 연결/AI 지연 분석은 숨김)", async () => {
    const { onQuickAction } = renderPanel("inprogress");
    await openMenu();
    const item = await screen.findByText("블로커 등록");
    expect(item.closest("button")?.textContent).not.toContain("준비 중");
    await userEvent.click(item);
    expect(onQuickAction).toHaveBeenCalledWith("블로커 등록", false);
    expect(screen.queryByText("PR 연결")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 지연 분석")).not.toBeInTheDocument();
  });

  it("inprogress: 진행상황 요청 클릭 시 알림을 보낸다", async () => {
    renderPanel("inprogress");
    await openMenu();
    await userEvent.click(await screen.findByText("진행상황 요청"));
    await waitFor(() => expect(sendTaskNudge).toHaveBeenCalledWith("TF-01", "PROGRESS", 1));
  });

  it("blocked: 담당자 재배정 클릭 시 onEditTask를 연다 (AI 해결안 보기/영향 업무 확인은 숨김)", async () => {
    const { onEditTask } = renderPanel("blocked");
    await openMenu();
    await userEvent.click(await screen.findByText("담당자 재배정"));
    expect(onEditTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("AI 해결안 보기")).not.toBeInTheDocument();
    expect(screen.queryByText("영향 업무 확인")).not.toBeInTheDocument();
  });

  it("blocked: 긴급 알림 클릭 시 알림을 보낸다", async () => {
    renderPanel("blocked");
    await openMenu();
    await userEvent.click(await screen.findByText("긴급 알림"));
    await waitFor(() => expect(sendTaskNudge).toHaveBeenCalledWith("TF-01", "URGENT", 1));
  });

  it("done: 다시 열기 기능은 삭제되어 메뉴에 보이지 않는다 (결과물 보기/AI 완료 요약도 숨김)", async () => {
    renderPanel("done");
    await openMenu();
    expect(screen.queryByText("다시 열기")).not.toBeInTheDocument();
    expect(screen.queryByText("결과물 보기")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 완료 요약")).not.toBeInTheDocument();
  });

  it("헤더의 + 버튼 클릭 시 onOpenWorkResult를 호출한다", async () => {
    const onOpenWorkResult = vi.fn();
    renderPanel("todo", { onOpenWorkResult });
    await userEvent.click(screen.getByTitle("작업 내용 작성"));
    expect(onOpenWorkResult).toHaveBeenCalledTimes(1);
  });

  it("showWorkResultButton이 false면 헤더의 + 버튼이 보이지 않는다 (완료 승인 화면 등)", async () => {
    renderPanel("todo", { showWorkResultButton: false });
    expect(screen.queryByTitle("작업 내용 작성")).not.toBeInTheDocument();
  });

  it("팀원에게는 넛지(시작 알림/진행상황 요청/긴급 알림) 메뉴가 보이지 않는다", async () => {
    // 담당자 본인(id 1)이어야 더보기 메뉴를 열 수 있다 - 그 안에서도 팀장 전용 넛지 항목은 숨겨져야 한다.
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 1 },
    });
    renderPanel("todo");
    await openMenu();
    expect(screen.queryByText("시작 알림")).not.toBeInTheDocument();
  });

  it("담당자가 아닌 팀원에게는 상태 이동 버튼(승인 신청)과 더보기 메뉴 자체가 보이지 않는다", async () => {
    // makeTask()의 assignee는 "1", 로그인한 유저는 id 999라 담당자가 아니다.
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 999 },
    });
    renderPanel("inprogress");
    expect(screen.queryByText("승인 신청")).not.toBeInTheDocument();
    expect(screen.queryByTitle("더보기")).not.toBeInTheDocument();
  });

  it("담당자 본인인 팀원에게는 상태 이동 버튼이 보인다", async () => {
    // makeTask()의 assignee는 "1"이므로 로그인 유저 id를 1로 맞춘다.
    mockUseAuth.mockReturnValue({
      currentProjectId: 1, currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" }, user: { id: 1 },
    });
    renderPanel("inprogress");
    expect(screen.getByText("승인 신청")).toBeInTheDocument();
    await openMenu();
    expect(screen.getByText("블로커 등록")).toBeInTheDocument();
  });
});
