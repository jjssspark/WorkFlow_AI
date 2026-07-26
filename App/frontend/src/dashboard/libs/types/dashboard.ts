// Spring dashboard 모듈(dashboard.DTO.*)의 응답을 그대로 반영한 타입.
// Spring은 이 값들을 record로 직렬화하므로 필드명이 camelCase 그대로 온다
// (rag/meetings처럼 FastAPI 응답을 원문 그대로 통과시키는 snake_case 케이스와 다름).

export interface UpcomingTaskDto {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
}

export interface WorkloadEntryDto {
  assigneeId: string;
  assigneeName: string | null;
  total: number;
  done: number;
  todo: number;
  inProgress: number;
  blocked: number;
}

export interface ActivityItemDto {
  id: string;
  type: string;
  actorName: string | null;
  message: string | null;
  targetId: string | null;
  createdAt: string | null;
}

export interface DashboardTaskDto {
  id: string;
  title: string;
  category: string | null;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string | null;
  description: string | null;
  sourceType: string | null;
  position: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardSummaryResponse {
  totalTasks: number;
  doneTasks: number;
  progressPercent: number;
  blockedTasks: number;
  inProgressTasks: number;
  upcomingDeadlines: UpcomingTaskDto[];
  workload: WorkloadEntryDto[];
  recentActivity: ActivityItemDto[];
}

export interface MilestoneProgressDto {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  taskCount: number;
  doneCount: number;
  progressPercent: number;
}

export interface CategoryProgressDto {
  category: string;
  total: number;
  done: number;
}

export type DelayRiskResult = "정상" | "주의" | "위험";

export interface DelayRiskDto {
  taskId: string;
  taskTitle: string;
  assigneeName: string | null;
  status: string;
  dueDate: string | null;
  result: DelayRiskResult | string;
  score: number | null;
  predictedAt: string | null;
}

export interface ProgressDetailResponse {
  totalTasks: number;
  doneTasks: number;
  progressPercent: number;
  milestones: MilestoneProgressDto[];
  categoryBreakdown: CategoryProgressDto[];
  delayRisks: DelayRiskDto[];
  hasPredictions: boolean;
  projectDeadline: string | null;
  projectCreatedAt: string | null;
}
