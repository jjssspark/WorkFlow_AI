import { describe, expect, it } from "vitest";
import { formatWorkloadCalculatedAt } from "./WorkloadPage";

describe("formatWorkloadCalculatedAt", () => {
  it("renders the calculated time so a cached score is not mistaken for a fresh one", () => {
    // GET /workload-score는 최대 30일 보관된 마지막 계산 결과를 돌려준다.
    const result = formatWorkloadCalculatedAt("2026-07-01T09:00:00Z");

    expect(result).not.toBe("");
    expect(result).toContain("2026");
    expect(result).not.toContain("알 수 없음");
  });

  it("says the time is unknown instead of inventing one for pre-timestamp cache entries", () => {
    expect(formatWorkloadCalculatedAt(null)).toContain("알 수 없음");
  });

  it("says the time is unknown when the stored value is not a parseable date", () => {
    expect(formatWorkloadCalculatedAt("not-a-date")).toContain("알 수 없음");
  });
});
