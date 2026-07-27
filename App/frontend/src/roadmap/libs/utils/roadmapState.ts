import type { RoadmapMilestone, RoadmapResponse, RoadmapTask } from "../types/roadmap";

function compareDates(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

export function compareTasksBySchedule(left: RoadmapTask, right: RoadmapTask): number {
  return compareDates(left.startDate, right.startDate)
    || compareDates(left.dueDate, right.dueDate)
    || left.title.localeCompare(right.title, "ko");
}

export function compareMilestonesBySchedule(left: RoadmapMilestone, right: RoadmapMilestone): number {
  return compareDates(left.startDate, right.startDate)
    || compareDates(left.dueDate, right.dueDate)
    || left.title.localeCompare(right.title, "ko");
}

function recalculate(milestone: RoadmapMilestone): RoadmapMilestone {
  const doneCount = milestone.tasks.filter((task) => task.status === "done").length;
  return {
    ...milestone,
    taskCount: milestone.tasks.length,
    doneCount,
    progressPercent: milestone.tasks.length === 0 ? 0 : Math.round(doneCount * 100 / milestone.tasks.length),
  };
}

export function sortRoadmapBySchedule(source: RoadmapResponse): RoadmapResponse {
  return {
    ...source,
    milestones: source.milestones
      .map((milestone) => ({
        ...milestone,
        tasks: [...milestone.tasks]
          .sort(compareTasksBySchedule)
          .map((task, position) => ({ ...task, position })),
      }))
      .sort(compareMilestonesBySchedule),
    unassignedTasks: [...source.unassignedTasks]
      .sort(compareTasksBySchedule)
      .map((task, position) => ({ ...task, position })),
  };
}

export function moveTasksToMilestone(
  source: RoadmapResponse,
  taskIds: Iterable<string>,
  targetMilestoneId: string | null,
): RoadmapResponse {
  const movingIds = new Set(taskIds);
  if (movingIds.size === 0) return source;

  const movedTasks: RoadmapTask[] = [];
  const milestonesWithoutMoved = source.milestones.map((milestone) => {
    for (const task of milestone.tasks) {
      if (movingIds.has(task.id)) movedTasks.push({ ...task, milestoneId: targetMilestoneId });
    }
    return recalculate({
      ...milestone,
      tasks: milestone.tasks.filter((task) => !movingIds.has(task.id)),
    });
  });

  for (const task of source.unassignedTasks) {
    if (movingIds.has(task.id)) movedTasks.push({ ...task, milestoneId: targetMilestoneId });
  }
  if (movedTasks.length === 0) return source;

  const remainingUnassigned = source.unassignedTasks.filter((task) => !movingIds.has(task.id));
  if (targetMilestoneId === null) {
    const unassignedTasks = [...remainingUnassigned, ...movedTasks]
      .map((task, position) => ({ ...task, position }));
    return {
      ...source,
      milestones: milestonesWithoutMoved,
      unassignedTasks,
    };
  }

  return {
    ...source,
    unassignedTasks: remainingUnassigned,
    milestones: milestonesWithoutMoved.map((milestone) => milestone.id === targetMilestoneId
      ? recalculate({
        ...milestone,
        tasks: [...milestone.tasks, ...movedTasks].map((task, position) => ({ ...task, position })),
      })
      : milestone),
  };
}

export interface RoadmapReorderResult {
  roadmap: RoadmapResponse;
  orderedTargetTasks: RoadmapTask[];
}

export function reorderTasksAtTarget(
  source: RoadmapResponse,
  taskIds: Iterable<string>,
  targetTaskId: string,
  placement: "before" | "after",
): RoadmapReorderResult | null {
  const movingIdOrder = [...taskIds];
  const movingIds = new Set(movingIdOrder);
  if (movingIds.size === 0 || movingIds.has(targetTaskId)) return null;

  const allTasks = [
    ...source.milestones.flatMap((milestone) => milestone.tasks),
    ...source.unassignedTasks,
  ];
  const targetTask = allTasks.find((task) => task.id === targetTaskId);
  if (!targetTask) return null;

  const movingTasks = movingIdOrder
    .map((taskId) => allTasks.find((task) => task.id === taskId))
    .filter((task): task is RoadmapTask => task !== undefined)
    .map((task) => ({ ...task, milestoneId: targetTask.milestoneId }));
  if (movingTasks.length === 0) return null;

  const currentTargetTasks = targetTask.milestoneId === null
    ? source.unassignedTasks
    : source.milestones.find((milestone) => milestone.id === targetTask.milestoneId)?.tasks ?? [];
  const targetWithoutMoved = currentTargetTasks.filter((task) => !movingIds.has(task.id));
  const targetIndex = targetWithoutMoved.findIndex((task) => task.id === targetTaskId);
  if (targetIndex === -1) return null;

  const insertAt = placement === "after" ? targetIndex + 1 : targetIndex;
  const orderedTargetTasks = [...targetWithoutMoved];
  orderedTargetTasks.splice(insertAt, 0, ...movingTasks);
  const positionedTargetTasks = orderedTargetTasks.map((task, position) => ({
    ...task,
    milestoneId: targetTask.milestoneId,
    position,
  }));

  const milestonesWithoutMoved = source.milestones.map((milestone) => recalculate({
    ...milestone,
    tasks: milestone.tasks.filter((task) => !movingIds.has(task.id)),
  }));
  const remainingUnassigned = source.unassignedTasks.filter((task) => !movingIds.has(task.id));

  if (targetTask.milestoneId === null) {
    return {
      roadmap: {
        ...source,
        milestones: milestonesWithoutMoved,
        unassignedTasks: positionedTargetTasks,
      },
      orderedTargetTasks: positionedTargetTasks,
    };
  }

  return {
    roadmap: {
      ...source,
      unassignedTasks: remainingUnassigned,
      milestones: milestonesWithoutMoved.map((milestone) => milestone.id === targetTask.milestoneId
        ? recalculate({ ...milestone, tasks: positionedTargetTasks })
        : milestone),
    },
    orderedTargetTasks: positionedTargetTasks,
  };
}
