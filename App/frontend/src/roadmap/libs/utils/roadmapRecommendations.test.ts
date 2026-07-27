import { describe, expect, it } from "vitest";
import { buildCapstoneMilestones, CAPSTONE_STAGE_TITLES } from "./roadmapRecommendations";

describe("capstone roadmap recommendations", () => {
  it("splits the whole project period into five ordered stages", () => {
    const stages = buildCapstoneMilestones("2026-03-02", "2026-06-19");

    expect(stages.map((stage) => stage.title)).toEqual(CAPSTONE_STAGE_TITLES);
    expect(stages[0].startDate).toBe("2026-03-02");
    expect(stages.at(-1)?.dueDate).toBe("2026-06-19");
    stages.forEach((stage, index) => {
      expect(stage.startDate! <= stage.dueDate!).toBe(true);
      if (index > 0) expect(stages[index - 1].dueDate! < stage.startDate!).toBe(true);
    });
  });

  it("keeps every recommended stage inside a very short project period", () => {
    const stages = buildCapstoneMilestones("2026-07-01", "2026-07-02");

    expect(stages).toHaveLength(5);
    expect(stages.every((stage) => stage.startDate! >= "2026-07-01" && stage.dueDate! <= "2026-07-02")).toBe(true);
  });
});
