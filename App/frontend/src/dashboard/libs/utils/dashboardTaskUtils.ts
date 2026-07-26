import type { Priority, TaskStatus } from "../../../board/libs/types/task";
import type { DashboardTaskDto } from "../types/dashboard";
import { resolveMemberDisplay } from "./memberDisplay";

const VALID_STATUSES: TaskStatus[] = ["todo", "inprogress", "done", "blocked"];
const VALID_PRIORITIES: Priority[] = ["low", "medium", "high"];

export function normalizeTaskStatus(status: string): TaskStatus {
  const normalized = status.toLowerCase() as TaskStatus;
  return VALID_STATUSES.includes(normalized) ? normalized : "todo";
}

export function normalizePriority(priority: string | null | undefined): Priority {
  const normalized = (priority ?? "").toLowerCase() as Priority;
  return VALID_PRIORITIES.includes(normalized) ? normalized : "medium";
}

export function formatDashboardDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) return "미정";
  const [, month, day] = dueDate.slice(0, 10).split("-");
  return month && day ? `${month}.${day}` : dueDate;
}

export function daysUntilDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

export function formatDDay(dueDate: string | null | undefined): string {
  const days = daysUntilDue(dueDate);
  if (days == null) return "미정";
  if (days === 0) return "D-Day";
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 프로젝트 기간 중 오늘까지 지난 비율을 0~100%로 환산한다. */
export function expectedProgressPercent(
  projectCreatedAt: string | null | undefined,
  projectDeadline: string | null | undefined,
  now = Date.now(),
): number | null {
  const startedAt = parseLocalDate(projectCreatedAt);
  const deadline = parseLocalDate(projectDeadline);
  if (!startedAt || !deadline || deadline.getTime() <= startedAt.getTime()) return null;
  const elapsedRatio = (now - startedAt.getTime()) / (deadline.getTime() - startedAt.getTime());
  return Math.round(Math.min(Math.max(elapsedRatio, 0), 1) * 100);
}

export function isDangerDelayRisk(result: string): boolean {
  const normalized = result.trim().toLowerCase();
  return result.includes("위험") || normalized.includes("danger") || normalized.includes("high");
}

export function isDelayRisk(result: string): boolean {
  const normalized = result.trim().toLowerCase();
  return isDangerDelayRisk(result)
    || result.includes("주의")
    || normalized.includes("warning")
    || normalized.includes("caution");
}

/** ISO 날짜/일시 문자열부터 지금까지 경과한 시간을 "일" 단위로 내림 계산한다.
 * 캘린더 날짜 경계가 아니라 실제 경과 시간 기준(체류시간 근사 — 백엔드 ML 피처
 * hours_in_current_status와 동일한 방식)이라 "3일 이상"류 임계값 판정에 적합하다. */
export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const past = new Date(dateStr);
  if (Number.isNaN(past.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - past.getTime()) / 86400000));
}

/** "오늘"/"어제"/"n일 전"(30일 이상이면 MM.DD) — 캘린더 날짜 경계 기준 상대 날짜 표기.
 * daysSince와 달리 사람이 읽는 라벨이라 자정 기준으로 날짜를 비교한다. */
export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "미정";
  const past = new Date(dateStr);
  if (Number.isNaN(past.getTime())) return "미정";
  const pastDay = new Date(past.getFullYear(), past.getMonth(), past.getDate()).getTime();
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((todayDay - pastDay) / 86400000);
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 30) return `${diffDays}일 전`;
  return formatDashboardDueDate(dateStr);
}

export function sourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "직접 생성";

  const normalized = sourceType.toUpperCase();
  if (normalized.includes("MEETING")) return "회의록 AI";
  // if (normalized.includes("MANUAL")) return "직접 생성";
  // return sourceType;
  
  return "직접 생성";
}

export function taskAssignee(task: DashboardTaskDto, index: number) {
  return resolveMemberDisplay(task.assigneeName, index, task.assigneeId);
}

export function isOpenTask(task: DashboardTaskDto): boolean {
  return normalizeTaskStatus(task.status) !== "done";
}

export function taskSearchText(task: DashboardTaskDto): string {
  return [
    task.id,
    task.title,
    task.category ?? "",
    task.assigneeName ?? "",
    task.description ?? "",
    sourceLabel(task.sourceType),
  ].join(" ").toLowerCase();
}

/** targetStatus 컬럼(상태)의 맨 끝에 이어붙일 position 값을 계산한다.
 * 보드의 reorderTasks()/computeInsertPosition()과 동일한 "마지막 카드 position + 1" 규칙을
 * 쓴다 — 대시보드 화면의 빠른 상태 변경 버튼이 원래 있던 컬럼의 position을 그대로 들고 가면
 * 대상 컬럼의 기존 카드와 값이 겹칠 수 있어, 항상 대상 컬럼 끝에 배치되도록 새로 계산한다. */
export function nextPositionForStatus(tasks: DashboardTaskDto[], status: string): number {
  const columnTasks = tasks.filter(task => normalizeTaskStatus(task.status) === status);
  if (columnTasks.length === 0) return 0;
  return Math.max(...columnTasks.map(task => task.position)) + 1;
}
