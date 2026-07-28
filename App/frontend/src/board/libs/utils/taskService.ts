import { CATEGORIES, TASKS } from "../mock/tasks";
import type { CategoryDef, Task, TaskStatus } from "../types/task";

// 회의록 AI 등 다른 경로로 생성된 업무는 카테고리가 "QA"처럼 대문자일 수 있어 소문자로 맞춰 비교한다.
// "기타"를 고르고 직접 입력한 카테고리명처럼 알려진 18종과 매칭되지 않는 값은,
// "기타"의 아이콘/색상은 그대로 쓰되 라벨만 실제 입력값으로 바꿔서 화면에 그대로 보여준다.
export function getCat(id: string): CategoryDef {
  const normalized = (id ?? "").toLowerCase();
  const matched = CATEGORIES.find(c => c.id === normalized);
  if (matched) return matched;
  const other = CATEGORIES[CATEGORIES.length - 1];
  return id ? { ...other, label: id } : other;
}

// Task.dueDate는 내부적으로 ISO(YYYY-MM-DD)를 쓰고, 화면 표시할 때만 이 함수로 "M.D" 형태로 변환한다.
export function formatDueDate(iso: string): string {
  if (!iso) return "미정";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${year}.${month}.${day}`;
}

// 칸반 카드 전용 표시: 시작일/마감일이 모두 올해면 연도를 생략해 "MM.DD"로, 하나라도 다른 해면 "YYYY.MM.DD"로 표시한다.
export function shouldHideYearOnBoard(startDate: string, dueDate: string): boolean {
  const currentYear = String(new Date().getFullYear());
  const years = [startDate, dueDate].filter(Boolean).map((d) => d.split("-")[0]);
  return years.length > 0 && years.every((y) => y === currentYear);
}

export function formatBoardTaskDate(iso: string, hideYear: boolean): string {
  if (!iso) return "미정";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return hideYear ? `${month}.${day}` : `${year}.${month}.${day}`;
}

export function getTasksByStatus(status: TaskStatus, tasks: Task[] = TASKS): Task[] {
  return tasks.filter(t => t.status === status);
}

export function getDoneCount(tasks: Task[] = TASKS): number {
  return tasks.filter(t => t.status === "done").length;
}

export function getProgressPercent(tasks: Task[] = TASKS): number {
  if (tasks.length === 0) return 0;
  return Math.round((getDoneCount(tasks) / tasks.length) * 100);
}

export function getBlockedCount(tasks: Task[] = TASKS): number {
  return tasks.filter(t => t.status === "blocked").length;
}

export function getInProgressCount(tasks: Task[] = TASKS): number {
  return tasks.filter(t => t.status === "inprogress").length;
}

/**
 * 같은 컬럼(status) 안에서 insertAtIndex 위치에 넣을 position 값을 계산한다.
 * columnTasks는 옮겨질 업무를 뺀, 그 컬럼의 현재 표시 순서(position 오름차순)여야 한다.
 * 앞뒤 카드의 position 중간값을 쓰고(Trello 등이 쓰는 표준 기법), 끝에 놓으면 ±1.
 */
export function computeInsertPosition(columnTasks: Task[], insertAtIndex: number): number {
  const prev = columnTasks[insertAtIndex - 1];
  const next = columnTasks[insertAtIndex];
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return 0;
}

/**
 * 업무(taskId)를 targetStatus 컬럼의 insertAtIndex 위치로 옮긴 새 배열과, 저장할 새 position을 계산한다.
 * 드래그앤드롭(컬럼 이동/같은 컬럼 재정렬)과 빠른 액션 버튼(컬럼 맨 끝에 추가) 모두 이 함수 하나로 처리한다.
 * 반환된 tasks 배열은 항상 "표시 순서"(같은 status끼리는 position 오름차순)를 그대로 반영한다.
 * 다른 status의 카드들은 화면에서 항상 status로 필터링해서 렌더링하므로, 배열 안 상대 위치가 어디든 상관없다.
 */
export function reorderTasks(
  tasks: Task[],
  taskId: string,
  targetStatus: TaskStatus,
  insertAtIndex: number
): { next: Task[]; newPosition: number } | null {
  const dragged = tasks.find(t => t.id === taskId);
  if (!dragged) return null;

  const withoutDragged = tasks.filter(t => t.id !== taskId);
  const columnTasks = withoutDragged.filter(t => t.status === targetStatus);
  const newPosition = computeInsertPosition(columnTasks, insertAtIndex);
  const movedTask = { ...dragged, status: targetStatus, position: newPosition };

  // columnTasks[insertAtIndex]가 있으면 그 카드 바로 앞에, 없으면(컬럼 맨 끝) 그 컬럼 마지막 카드 바로 뒤에 끼워 넣는다.
  const anchor = columnTasks[insertAtIndex] ?? columnTasks[insertAtIndex - 1];
  const insertGlobalIndex = !anchor
    ? withoutDragged.length
    : withoutDragged.indexOf(anchor) + (columnTasks[insertAtIndex] ? 0 : 1);

  const next = [...withoutDragged];
  next.splice(insertGlobalIndex, 0, movedTask);
  return { next, newPosition };
}

/**
 * 다른 사용자가 옮긴 업무를 SSE로 받아 로컬 상태에 반영한다. reorderTasks와 달리 삽입 위치를
 * index가 아니라 이미 정해진 position 값으로 받으므로, 목적지 컬럼에 끼워 넣고 position
 * 오름차순으로 정렬하는 것으로 충분하다 - 정확한 삽입 인덱스를 따로 계산할 필요가 없다.
 */
export function applyRemoteTaskMove(
  tasks: Task[],
  taskId: string,
  status: TaskStatus,
  position: number
): Task[] {
  const target = tasks.find(t => t.id === taskId);
  if (!target) return tasks;

  const moved = { ...target, status, position };
  const withoutTarget = tasks.filter(t => t.id !== taskId);
  const outsideColumn = withoutTarget.filter(t => t.status !== status);
  const column = withoutTarget.filter(t => t.status === status)
    .concat(moved)
    .sort((a, b) => a.position - b.position);
  return [...outsideColumn, ...column];
}
