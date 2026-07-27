import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysSince,
  expectedProgressPercent,
  formatDashboardDueDate,
  formatDDay,
  formatRelativeDate,
  isDangerDelayRisk,
  isDelayRisk,
  nextPositionForStatus,
} from "./dashboardTaskUtils";
import type { DashboardTaskDto } from "../types/dashboard";

function taskFixture(overrides: Partial<DashboardTaskDto>): DashboardTaskDto {
  return {
    id: "1",
    title: "제목",
    category: null,
    status: "todo",
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    priority: null,
    description: null,
    sourceType: null,
    position: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("formatDashboardDueDate", () => {
  it("formats a date-only string as MM.DD", () => {
    expect(formatDashboardDueDate("2026-07-21")).toBe("07.21");
  });

  it("formats a full ISO datetime string as MM.DD", () => {
    expect(formatDashboardDueDate("2026-07-21T09:30:00")).toBe("07.21");
  });

  it("returns 미정 when null", () => {
    expect(formatDashboardDueDate(null)).toBe("미정");
  });
});

describe("daysSince / formatRelativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("daysSince returns 0 for a timestamp earlier today", () => {
    expect(daysSince("2026-07-21T08:00:00")).toBe(0);
  });

  it("daysSince returns elapsed whole days for an earlier timestamp", () => {
    expect(daysSince("2026-07-18T12:00:00")).toBe(3);
  });

  it("daysSince parses a date-only completion date as KST midnight", () => {
    expect(daysSince("2026-07-18")).toBe(3);
  });

  it("daysSince returns null when given null", () => {
    expect(daysSince(null)).toBeNull();
  });

  it("formatRelativeDate returns 오늘 for today", () => {
    expect(formatRelativeDate("2026-07-21T08:00:00")).toBe("오늘");
  });

  it("formatRelativeDate returns 어제 for the previous calendar day", () => {
    expect(formatRelativeDate("2026-07-20T23:50:00")).toBe("어제");
  });

  it("formatRelativeDate returns n일 전 for 2~29 days ago", () => {
    expect(formatRelativeDate("2026-07-15T12:00:00")).toBe("6일 전");
  });

  it("formatRelativeDate falls back to MM.DD for 30+ days ago", () => {
    expect(formatRelativeDate("2026-06-01T12:00:00")).toBe("06.01");
  });

  it("formatRelativeDate returns 미정 when null", () => {
    expect(formatRelativeDate(null)).toBe("미정");
  });
});

describe("dashboard schedule helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats project deadlines as D-Day labels", () => {
    expect(formatDDay("2026-07-21")).toBe("D-Day");
    expect(formatDDay("2026-07-24")).toBe("D-3");
    expect(formatDDay("2026-07-19")).toBe("D+2");
    expect(formatDDay(null)).toBe("미정");
  });

  it("calculates expected progress from the project schedule", () => {
    expect(expectedProgressPercent("2026-07-01", "2026-07-31", new Date("2026-07-16T00:00:00").getTime())).toBe(50);
    expect(expectedProgressPercent("2026-07-01", "2026-07-31", new Date("2026-06-01T00:00:00").getTime())).toBe(0);
    expect(expectedProgressPercent("2026-07-01", "2026-07-31", new Date("2026-08-01T00:00:00").getTime())).toBe(100);
    expect(expectedProgressPercent(null, "2026-07-31")).toBeNull();
  });
});

describe("nextPositionForStatus", () => {
  it("returns 0 when the target status column is empty", () => {
    const tasks = [taskFixture({ id: "1", status: "todo", position: 0 })];
    expect(nextPositionForStatus(tasks, "done")).toBe(0);
  });

  it("returns one past the highest position already in that status column", () => {
    const tasks = [
      taskFixture({ id: "1", status: "done", position: 2 }),
      taskFixture({ id: "2", status: "done", position: 5 }),
      taskFixture({ id: "3", status: "blocked", position: 99 }),
    ];
    expect(nextPositionForStatus(tasks, "done")).toBe(6);
  });
});

describe("delay risk result helpers", () => {
  it("distinguishes warning/danger predictions from normal results", () => {
    expect(isDelayRisk("주의")).toBe(true);
    expect(isDelayRisk("위험")).toBe(true);
    expect(isDelayRisk("정상")).toBe(false);
    expect(isDangerDelayRisk("주의")).toBe(false);
    expect(isDangerDelayRisk("위험")).toBe(true);
  });
});
