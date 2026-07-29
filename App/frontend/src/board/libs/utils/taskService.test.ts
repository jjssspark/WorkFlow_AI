import { describe, expect, it, vi, afterEach } from "vitest";
import { applyRemoteTaskMove, isTaskStatus, shouldHideYearOnBoard, formatBoardTaskDate } from "./taskService";
import type { Task } from "../types/task";

describe("shouldHideYearOnBoard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides year when start and due date are both this year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27"));
    expect(shouldHideYearOnBoard("2026-07-01", "2026-07-31")).toBe(true);
  });

  it("shows year when due date is a different year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27"));
    expect(shouldHideYearOnBoard("2026-12-01", "2027-01-05")).toBe(false);
  });

  it("shows year when start date is empty and due date is this year but differs from now via other year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27"));
    expect(shouldHideYearOnBoard("", "2026-08-01")).toBe(true);
    expect(shouldHideYearOnBoard("", "2027-08-01")).toBe(false);
  });
});

describe("formatBoardTaskDate", () => {
  it("omits year when hideYear is true", () => {
    expect(formatBoardTaskDate("2026-07-27", true)).toBe("07.27");
  });

  it("includes year when hideYear is false", () => {
    expect(formatBoardTaskDate("2026-07-27", false)).toBe("2026.07.27");
  });

  it("returns 미정 for empty date", () => {
    expect(formatBoardTaskDate("", true)).toBe("미정");
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1", title: "제목", status: "todo", priority: "medium", assignee: "",
    startDate: "", dueDate: "", labels: [], category: "backend", position: 0,
    pendingApproval: false, extraFields: {}, ...overrides,
  };
}

describe("isTaskStatus", () => {
  it("알려진 TaskStatus 값은 true를 반환한다", () => {
    expect(isTaskStatus("todo")).toBe(true);
    expect(isTaskStatus("inprogress")).toBe(true);
    expect(isTaskStatus("done")).toBe(true);
    expect(isTaskStatus("blocked")).toBe(true);
  });

  it("알 수 없는 값은 false를 반환한다", () => {
    expect(isTaskStatus("archived")).toBe(false);
    expect(isTaskStatus("")).toBe(false);
    expect(isTaskStatus("TODO")).toBe(false);
  });
});

describe("applyRemoteTaskMove", () => {
  it("같은 컬럼 안에서 position 기준으로 올바른 자리에 다시 끼워 넣는다", () => {
    const tasks = [
      makeTask({ id: "1", status: "todo", position: 0 }),
      makeTask({ id: "2", status: "todo", position: 2 }),
      makeTask({ id: "3", status: "todo", position: 3 }),
    ];

    const next = applyRemoteTaskMove(tasks, "3", "todo", 1.5);

    expect(next.filter(t => t.status === "todo").map(t => t.id)).toEqual(["1", "3", "2"]);
  });

  it("다른 컬럼으로 이동하면 원래 컬럼에서 빠지고 새 컬럼에 position 순서로 들어간다", () => {
    const tasks = [
      makeTask({ id: "1", status: "todo", position: 0 }),
      makeTask({ id: "2", status: "inprogress", position: 0 }),
      makeTask({ id: "3", status: "inprogress", position: 2 }),
    ];

    const next = applyRemoteTaskMove(tasks, "1", "inprogress", 1);

    expect(next.find(t => t.id === "1")?.status).toBe("inprogress");
    expect(next.filter(t => t.status === "todo")).toHaveLength(0);
    expect(next.filter(t => t.status === "inprogress").map(t => t.id)).toEqual(["2", "1", "3"]);
  });

  it("아직 로드되지 않은 taskId는 무시하고 배열을 그대로(같은 참조) 반환한다", () => {
    const tasks = [makeTask({ id: "1" })];

    const next = applyRemoteTaskMove(tasks, "999", "done", 0);

    expect(next).toBe(tasks);
  });
});
