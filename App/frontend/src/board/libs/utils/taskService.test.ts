import { describe, expect, it, vi, afterEach } from "vitest";
import { shouldHideYearOnBoard, formatBoardTaskDate } from "./taskService";

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
