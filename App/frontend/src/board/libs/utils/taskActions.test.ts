import { describe, expect, it } from "vitest";
import { STATUS_ACTIONS, visibleSecondaryActions, quickMoveTargetStatus, canMoveTask } from "./taskActions";
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
