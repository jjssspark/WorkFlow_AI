import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeAction } from "./actionExecutor";
import { updateTaskPosition, updateTask, deleteTask } from "../../../board/libs/utils/taskApi";
import { createTaskComment } from "../../../board/libs/utils/taskCommentApi";
import { fetchChecklist, updateChecklistItem } from "../../../board/libs/utils/checklistApi";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";
import type { ActionCard } from "../types/command";

vi.mock("../../../board/libs/utils/taskApi", () => ({
  updateTaskPosition: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../../../board/libs/utils/taskCommentApi", () => ({ createTaskComment: vi.fn() }));
vi.mock("../../../board/libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn(),
  updateChecklistItem: vi.fn(),
}));
vi.mock("../../../global/api/projectsApi", () => ({ getProjectMembers: vi.fn() }));

function member(userId: number, name: string): MemberResponse {
  return { userId, name, email: `${userId}@example.com`, role: "팀원" };
}

function card(overrides: Partial<ActionCard>): ActionCard {
  return {
    stepId: "0-abc",
    tool: "change_status",
    taskId: 37,
    title: "업무 상태 변경",
    summary: "요약",
    args: { to: "done" },
    ...overrides,
  };
}

describe("executeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the existing status API for change_status", async () => {
    vi.mocked(updateTaskPosition).mockResolvedValue({} as never);

    const result = await executeAction(card({}), 1);

    expect(result.ok).toBe(true);
    expect(updateTaskPosition).toHaveBeenCalledWith("37", "done", expect.any(Number), 1);
  });

  it("calls the existing comment API for add_comment", async () => {
    vi.mocked(createTaskComment).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "add_comment", args: { content: "확인했습니다" } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(createTaskComment).toHaveBeenCalledWith("37", "확인했습니다", 1);
  });

  it("reports failure with the server message instead of throwing", async () => {
    vi.mocked(updateTaskPosition).mockRejectedValue(new Error("권한이 없습니다"));

    const result = await executeAction(card({}), 1);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("권한이 없습니다");
  });

  it("refuses unknown tools without calling any API", async () => {
    const result = await executeAction(card({ tool: "drop_database" }), 1);

    expect(result.ok).toBe(false);
    expect(updateTaskPosition).not.toHaveBeenCalled();
  });

  it("refuses a card without a task id", async () => {
    const result = await executeAction(card({ taskId: null }), 1);

    expect(result.ok).toBe(false);
    expect(updateTaskPosition).not.toHaveBeenCalled();
  });

  it("toggles the matching checklist item", async () => {
    vi.mocked(fetchChecklist).mockResolvedValue([
      { id: 1, label: "코드 리뷰", done: false },
      { id: 2, label: "테스트 작성", done: false },
    ] as never);
    vi.mocked(updateChecklistItem).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "toggle_checklist", args: { item: "테스트", done: true } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateChecklistItem).toHaveBeenCalledWith("37", 2, { done: true }, 1);
  });

  it("refuses to guess when multiple checklist items partially match", async () => {
    vi.mocked(fetchChecklist).mockResolvedValue([
      { id: 1, label: "리뷰 요청", done: false },
      { id: 2, label: "리뷰 반영", done: false },
    ] as never);

    const result = await executeAction(
      card({ tool: "toggle_checklist", args: { item: "리뷰", done: true } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateChecklistItem).not.toHaveBeenCalled();
  });

  it("prefers an exact label match over a partial one", async () => {
    vi.mocked(fetchChecklist).mockResolvedValue([
      { id: 1, label: "리뷰", done: false },
      { id: 2, label: "리뷰 반영", done: false },
    ] as never);
    vi.mocked(updateChecklistItem).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "toggle_checklist", args: { item: "리뷰", done: true } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateChecklistItem).toHaveBeenCalledWith("37", 1, { done: true }, 1);
  });

  it("sets the due date via the task update API", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "set_due_date", args: { date: "2026-08-10" } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("37", { dueDate: "2026-08-10" }, 1);
  });

  it("refuses a malformed due date without calling the API", async () => {
    const result = await executeAction(
      card({ tool: "set_due_date", args: { date: "8월 10일" } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses a well-formed but nonexistent calendar date", async () => {
    for (const date of ["2026-99-99", "2026-02-30"]) {
      const result = await executeAction(card({ tool: "set_due_date", args: { date } }), 1);
      expect(result.ok).toBe(false);
    }
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses an empty checklist item instead of matching the first one", async () => {
    // item이 빈 문자열이면 label.includes("")가 항상 참이라 첫 항목을 잘못 토글할 수 있다.
    const result = await executeAction(
      card({ tool: "toggle_checklist", args: { item: "", done: true } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(fetchChecklist).not.toHaveBeenCalled();
    expect(updateChecklistItem).not.toHaveBeenCalled();
  });

  it("calls the existing task API for rename_task", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "rename_task", args: { title: "  로그인 API 리팩터링  " } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("37", { title: "로그인 API 리팩터링" }, 1);
  });

  it("refuses an empty new title without calling the API", async () => {
    const result = await executeAction(card({ tool: "rename_task", args: { title: "   " } }), 1);

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses a title longer than the tasks.title column", async () => {
    // VARCHAR(200)을 넘기면 DB가 거절해 사용자에게는 원인 모를 500으로 보인다.
    const result = await executeAction(
      card({ tool: "rename_task", args: { title: "가".repeat(201) } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("resolves the assignee name to a member id for change_assignee", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김철수"), member(9, "이영희")]);
    vi.mocked(updateTask).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "김철수" } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("37", { assigneeId: "5" }, 1);
  });

  it("falls back to a partial name match when there is exactly one", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김철수"), member(9, "이영희")]);
    vi.mocked(updateTask).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "철수" } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("37", { assigneeId: "5" }, 1);
  });

  it("refuses to guess between members with the same name", async () => {
    // 동명이인일 때 첫 번째를 고르면 조용히 틀린 사람에게 배정된다.
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김철수"), member(8, "김철수")]);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "김철수" } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous partial name match", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김민수"), member(8, "박민수")]);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "민수" } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("prefers an exact name match over a longer partial one", async () => {
    // "김민"이 "김민수"에도 부분 일치하지만, 정확히 같은 이름이 있으면 그 사람이다.
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김민"), member(8, "김민수")]);
    vi.mocked(updateTask).mockResolvedValue({} as never);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "김민" } }),
      1
    );

    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("37", { assigneeId: "5" }, 1);
  });

  it("refuses when the name matches no project member", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([member(5, "김철수")]);

    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "홍길동" } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("refuses an empty assignee name without fetching members", async () => {
    // 빈 이름이면 includes("")가 모두 참이라 아무나 걸린다.
    const result = await executeAction(
      card({ tool: "change_assignee", args: { assignee_name: "   " } }),
      1
    );

    expect(result.ok).toBe(false);
    expect(getProjectMembers).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("calls the existing delete API for delete_task", async () => {
    vi.mocked(deleteTask).mockResolvedValue(undefined);

    const result = await executeAction(card({ tool: "delete_task", args: {} }), 1);

    expect(result.ok).toBe(true);
    expect(deleteTask).toHaveBeenCalledWith("37", 1);
  });

  it("deletes only the task id carried by the card", async () => {
    // 되돌릴 수 없는 도구라 대상을 다시 추측하거나 넓히면 안 된다.
    vi.mocked(deleteTask).mockResolvedValue(undefined);

    await executeAction(card({ tool: "delete_task", taskId: 91, args: {} }), 1);

    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).toHaveBeenCalledWith("91", 1);
  });

  it("refuses delete_task without a resolved task id", async () => {
    const result = await executeAction(card({ tool: "delete_task", taskId: null, args: {} }), 1);

    expect(result.ok).toBe(false);
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("reports a failed delete instead of claiming success", async () => {
    vi.mocked(deleteTask).mockRejectedValue(new Error("이미 삭제된 업무입니다."));

    const result = await executeAction(card({ tool: "delete_task", args: {} }), 1);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("이미 삭제된 업무입니다.");
  });
});
