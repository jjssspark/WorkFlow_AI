import { describe, expect, it } from "vitest";
import { getDueToday, getDueThisWeek } from "./taskWidgets";
import type { Task } from "../../../board/libs/types/task";

function makeTask(id: string, dueDate: string): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    assignee: "1",
    dueDate,
    labels: [],
    category: "other",
    position: 0,
    pendingApproval: false,
    startDate: "",
    extraFields: {},
  };
}

// 고정된 기준일: 2026-01-14 (수요일). 그 주는 월요일 2026-01-12 ~ 일요일 2026-01-18.
const NOW = new Date(2026, 0, 14);

describe("getDueToday", () => {
  it("returns only tasks due exactly on the given date", () => {
    const tasks = [makeTask("A", "2026-01-14"), makeTask("B", "2026-01-13"), makeTask("C", "2026-01-15")];
    expect(getDueToday(tasks, NOW).map((t) => t.id)).toEqual(["A"]);
  });

  it("excludes tasks with no due date", () => {
    const tasks = [makeTask("A", "")];
    expect(getDueToday(tasks, NOW)).toEqual([]);
  });
});

describe("getDueThisWeek", () => {
  it("includes tasks due on the Monday and Sunday of the current week", () => {
    const tasks = [makeTask("MON", "2026-01-12"), makeTask("SUN", "2026-01-18")];
    expect(getDueThisWeek(tasks, NOW).map((t) => t.id).sort()).toEqual(["MON", "SUN"]);
  });

  it("excludes tasks due the following Monday or the previous Sunday", () => {
    const tasks = [makeTask("NEXT", "2026-01-19"), makeTask("PREV", "2026-01-11")];
    expect(getDueThisWeek(tasks, NOW)).toEqual([]);
  });

  it("excludes tasks with no due date", () => {
    const tasks = [makeTask("A", "")];
    expect(getDueThisWeek(tasks, NOW)).toEqual([]);
  });
});
