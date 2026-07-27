import { describe, expect, it } from "vitest";
import type { RoadmapResponse } from "../types/roadmap";
import { moveTasksToMilestone, reorderTasksAtTarget, sortRoadmapBySchedule } from "./roadmapState";

const roadmap: RoadmapResponse = {
  project: { id: "1", title: "프로젝트", startDate: "2026-07-01", deadline: "2026-08-31" },
  milestones: [
    {
      id: "late",
      title: "후반",
      startDate: "2026-08-01",
      dueDate: "2026-08-31",
      taskCount: 1,
      doneCount: 0,
      progressPercent: 0,
      tasks: [
        {
          id: "b", milestoneId: "late", title: "두 번째", category: "other", status: "todo",
          assigneeId: null, assigneeName: null, startDate: "2026-08-10", dueDate: "2026-08-20",
          priority: "medium", position: 0,
        },
      ],
    },
    {
      id: "early",
      title: "전반",
      startDate: "2026-07-01",
      dueDate: "2026-07-31",
      taskCount: 2,
      doneCount: 1,
      progressPercent: 50,
      tasks: [
        {
          id: "no-date", milestoneId: "early", title: "미정 업무", category: "other", status: "done",
          assigneeId: null, assigneeName: null, startDate: null, dueDate: null,
          priority: "medium", position: 1,
        },
        {
          id: "a", milestoneId: "early", title: "첫 번째", category: "other", status: "todo",
          assigneeId: null, assigneeName: null, startDate: "2026-07-02", dueDate: "2026-07-05",
          priority: "medium", position: 0,
        },
      ],
    },
  ],
  unassignedTasks: [],
};

describe("roadmap state helpers", () => {
  it("sorts milestones and tasks by start date, due date, then title", () => {
    const sorted = sortRoadmapBySchedule(roadmap);

    expect(sorted.milestones.map((milestone) => milestone.id)).toEqual(["early", "late"]);
    expect(sorted.milestones[0].tasks.map((task) => task.id)).toEqual(["a", "no-date"]);
  });

  it("moves multiple selected tasks together and recalculates progress", () => {
    const moved = moveTasksToMilestone(roadmap, ["a", "b"], "late");

    expect(moved.milestones.find((milestone) => milestone.id === "early")?.tasks.map((task) => task.id))
      .toEqual(["no-date"]);
    expect(moved.milestones.find((milestone) => milestone.id === "early")?.progressPercent).toBe(100);
    expect(moved.milestones.find((milestone) => milestone.id === "late")?.tasks.map((task) => task.id))
      .toEqual(["b", "a"]);
  });

  it("reorders a task before another task inside the same milestone", () => {
    const result = reorderTasksAtTarget(roadmap, ["no-date"], "a", "before");

    expect(result?.roadmap.milestones.find((milestone) => milestone.id === "early")?.tasks.map((task) => task.id))
      .toEqual(["no-date", "a"]);
    expect(result?.orderedTargetTasks.map((task) => task.position)).toEqual([0, 1]);
  });

  it("moves a selected task group to a precise row position in another milestone", () => {
    const result = reorderTasksAtTarget(roadmap, ["a", "no-date"], "b", "after");

    expect(result?.roadmap.milestones.find((milestone) => milestone.id === "early")?.tasks).toEqual([]);
    expect(result?.orderedTargetTasks.map((task) => task.id)).toEqual(["b", "a", "no-date"]);
    expect(result?.orderedTargetTasks.every((task) => task.milestoneId === "late")).toBe(true);
  });
});
