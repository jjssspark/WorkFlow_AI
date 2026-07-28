import { describe, expect, it, vi } from "vitest";
import {
  STATUS_ACTIONS,
  visibleSecondaryActions,
  quickMoveTargetStatus,
  canMoveTask,
  runTaskMoveOnce,
  type TaskMoveQueue,
} from "./taskActions";
import type { Task } from "../types/task";

describe("visibleSecondaryActions", () => {
  const doneSecondary = STATUS_ACTIONS.done.filter((a) => !a.primary);

  it("hides 결과물 보기 and AI 완료 요약 regardless of role", () => {
    const labels = visibleSecondaryActions(doneSecondary, true, false).map((a) => a.label);
    expect(labels).not.toContain("결과물 보기");
    expect(labels).not.toContain("AI 완료 요약");
  });

  it("shows 팀장 피드백 for leaders regardless of assignee", () => {
    const labels = visibleSecondaryActions(doneSecondary, true, false).map((a) => a.label);
    expect(labels).toEqual(["팀장 피드백"]);
  });

  it("hides 팀장 피드백 for non-leaders", () => {
    expect(visibleSecondaryActions(doneSecondary, false, false).map((a) => a.label)).toEqual([]);
    expect(visibleSecondaryActions(doneSecondary, false, true).map((a) => a.label)).toEqual([]);
  });

  it("hides AI/PR/의존관계/중복 항목 that need out-of-scope integrations", () => {
    const todoSecondary = STATUS_ACTIONS.todo.filter((a) => !a.primary);
    const inprogressSecondary = STATUS_ACTIONS.inprogress.filter((a) => !a.primary);
    const blockedSecondary = STATUS_ACTIONS.blocked.filter((a) => !a.primary);

    expect(visibleSecondaryActions(todoSecondary, true, false).map((a) => a.label)).toEqual(["담당자 변경", "시작 알림"]);
    expect(visibleSecondaryActions(inprogressSecondary, true, false).map((a) => a.label)).toEqual(["블로커 등록", "진행상황 요청"]);
    expect(visibleSecondaryActions(blockedSecondary, true, false).map((a) => a.label)).toEqual(["긴급 알림", "담당자 재배정"]);
  });

  it("hides 넛지(시작 알림/진행상황 요청/긴급 알림)와 담당자 변경/재배정을 non-leaders에게는 숨긴다", () => {
    const todoSecondary = STATUS_ACTIONS.todo.filter((a) => !a.primary);
    const blockedSecondary = STATUS_ACTIONS.blocked.filter((a) => !a.primary);

    expect(visibleSecondaryActions(todoSecondary, false, false).map((a) => a.label)).toEqual([]);
    expect(visibleSecondaryActions(todoSecondary, false, true).map((a) => a.label)).toEqual([]);
    expect(visibleSecondaryActions(blockedSecondary, false, false).map((a) => a.label)).toEqual([]);
  });

  it("hides 상태 이동 보조 액션(블로커 등록)을 담당자가 아닌 팀원에게는 숨긴다", () => {
    const inprogressSecondary = STATUS_ACTIONS.inprogress.filter((a) => !a.primary);
    expect(visibleSecondaryActions(inprogressSecondary, false, false).map((a) => a.label)).toEqual([]);
    expect(visibleSecondaryActions(inprogressSecondary, false, true).map((a) => a.label)).toEqual(["블로커 등록"]);
  });
});

describe("quickMoveTargetStatus", () => {
  it("returns blocked when label is 블로커 등록 and status is inprogress", () => {
    expect(quickMoveTargetStatus("블로커 등록", "inprogress")).toBe("blocked");
  });

  it("returns null for other labels", () => {
    expect(quickMoveTargetStatus("팀장 피드백", "done")).toBeNull();
  });

  it("returns null when status doesn't match the label's expected origin", () => {
    expect(quickMoveTargetStatus("블로커 등록", "done")).toBeNull();
  });
});

describe("canMoveTask", () => {
  const task: Task = {
    id: "1", title: "제목", status: "todo", priority: "medium",
    assignee: "3", dueDate: "", labels: [], category: "other", position: 0, pendingApproval: false, startDate: "", extraFields: {},
  };

  it("allows leaders to move any task", () => {
    expect(canMoveTask(true, task, 999)).toBe(true);
    expect(canMoveTask(true, task, null)).toBe(true);
  });

  it("allows a member to move their own task", () => {
    expect(canMoveTask(false, task, 3)).toBe(true);
  });

  it("blocks a member from moving someone else's task", () => {
    expect(canMoveTask(false, task, 2)).toBe(false);
  });

  it("blocks a non-leader with no known user id", () => {
    expect(canMoveTask(false, task, null)).toBe(false);
    expect(canMoveTask(false, task, undefined)).toBe(false);
  });
});

describe("runTaskMoveOnce", () => {
  it("같은 업무를 같은 목적지로 옮기는 중복 요청은 앞선 요청이 대기/진행 중이면 실행하지 않는다", async () => {
    const queue: TaskMoveQueue = new Map();
    let resolveFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const action = vi.fn().mockImplementation(() => firstFinished);

    const first = runTaskMoveOnce(queue, "42", "inprogress", action);
    const duplicate = runTaskMoveOnce(queue, "42", "inprogress", action);

    await expect(duplicate).resolves.toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    resolveFirst();
    await expect(first).resolves.toBe(true);
    expect(queue.size).toBe(0);
  });

  it("같은 업무라도 목적지가 다르면 폐기하지 않되, 앞선 요청이 끝난 뒤에야 실행한다", async () => {
    const queue: TaskMoveQueue = new Map();
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const firstAction = vi.fn().mockImplementation(async () => {
      order.push("first-start");
      await firstFinished;
      order.push("first-end");
    });
    const secondAction = vi.fn().mockImplementation(async () => {
      order.push("second-start");
    });

    const first = runTaskMoveOnce(queue, "42", "inprogress", firstAction);
    const second = runTaskMoveOnce(queue, "42", "blocked", secondAction);

    // 마이크로태스크가 몇 차례 돌아도, 두 번째는 첫 번째가 끝나기 전엔 시작되지 않아야 한다.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    expect(secondAction).not.toHaveBeenCalled();

    resolveFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(queue.size).toBe(0);
  });

  it("앞선 요청이 실패해도 뒤에 대기 중인 다른 목적지 요청은 이어서 실행된다", async () => {
    const queue: TaskMoveQueue = new Map();
    const firstAction = vi.fn().mockRejectedValue(new Error("network error"));
    const secondAction = vi.fn().mockResolvedValue(undefined);

    const first = runTaskMoveOnce(queue, "42", "inprogress", firstAction);
    const second = runTaskMoveOnce(queue, "42", "blocked", secondAction);

    await expect(first).rejects.toThrow("network error");
    await expect(second).resolves.toBe(true);
    expect(secondAction).toHaveBeenCalledTimes(1);
  });
});
