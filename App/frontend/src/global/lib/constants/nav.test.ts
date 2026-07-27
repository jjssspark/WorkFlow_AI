import { describe, expect, it } from "vitest";
import { NAV_ITEMS, TAB_TITLES } from "./nav";

describe("roadmap navigation visibility", () => {
  it("keeps the roadmap title definition while hiding its navigation entry (now reachable via the 팀장페이지 tab)", () => {
    expect(TAB_TITLES.roadmap).toBe("로드맵");
    expect(NAV_ITEMS.some((item) => item.id === "roadmap")).toBe(false);
  });
});

describe("leader page navigation", () => {
  it("exposes a single 팀장페이지 entry that replaced the old standalone 완료 승인 entry", () => {
    expect(NAV_ITEMS.some((item) => item.id === "leader" && item.label === "팀장페이지")).toBe(true);
    expect(NAV_ITEMS.some((item) => item.id === "completion-approvals")).toBe(false);
  });

  it("keeps the 완료 승인 title definition for the nested tab label even though it has no top-level nav entry", () => {
    expect(TAB_TITLES["completion-approvals"]).toBe("완료 승인");
  });
});
