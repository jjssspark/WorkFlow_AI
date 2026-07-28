// Spring dashboard 모듈(dashboard.DTO.*)의 응답을 그대로 반영한 타입.
// Spring은 이 값들을 record로 직렬화하므로 필드명이 camelCase 그대로 온다
// (rag/meetings처럼 FastAPI 응답을 원문 그대로 통과시키는 snake_case 케이스와 다름).

export interface UpcomingTaskDto {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeId: string | null;
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
  actorId: string | null;
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
  /** status가 done으로 바뀐 날짜(YYYY-MM-DD). done이 아니면 null — '완료 업무' 관련 날짜는 이 필드를 기준으로 삼는다. */
  doneDate: string | null;
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
  /** startDate가 없는(과거) 마일스톤의 일정표 시작일 근사치로만 쓴다. */
  createdAt: string | null;
  taskIds: string[];
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

/** Redis Queue에 적재된 대시보드 ML 재분석 작업(지연 위험도/업무 편중)의 적재·상태 조회 공용 응답. */
export interface DashboardAiJobResponse {
  jobId: string;
  projectId: string;
  jobType: "DELAY_RISK" | "WORKLOAD_SCORE";
  status: "PROCESSING" | "DONE";
}
