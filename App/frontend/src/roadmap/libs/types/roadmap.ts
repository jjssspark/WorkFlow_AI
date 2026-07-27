export interface RoadmapProject {
  id: string;
  title: string;
  startDate: string | null;
  deadline: string | null;
}

export interface RoadmapTask {
  id: string;
  milestoneId: string | null;
  title: string;
  category: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: string | null;
  description?: string | null;
  position: number;
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  taskCount: number;
  doneCount: number;
  progressPercent: number;
  tasks: RoadmapTask[];
}

export interface RoadmapResponse {
  project: RoadmapProject;
  milestones: RoadmapMilestone[];
  unassignedTasks: RoadmapTask[];
}

export type RoadmapZoom = "month" | "week";
