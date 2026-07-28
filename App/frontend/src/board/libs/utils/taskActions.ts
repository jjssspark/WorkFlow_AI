import {
  ArrowRight, User, CheckSquare, Bell, Sparkles, CheckCircle2, AlertTriangle,
  GitPullRequest, AlertCircle, CheckCheck, MessageSquare, Eye,
} from "lucide-react";
import type { Task, TaskStatus } from "../types/task";

export const STATUS_LABELS: Record<TaskStatus, string> = { todo: "할 일", inprogress: "진행 중", blocked: "보류/블로커", done: "완료" };

export const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: "inprogress", inprogress: "done", blocked: "inprogress", done: null,
};

export interface StatusAction { label: string; icon: any; primary?: boolean; danger?: boolean; }

export const STATUS_ACTIONS: Record<TaskStatus, StatusAction[]> = {
  todo: [
    { label:"진행 중으로 이동", icon:ArrowRight, primary:true },
    { label:"담당자 변경", icon:User },
    { label:"체크리스트 생성", icon:CheckSquare },
    { label:"시작 알림", icon:Bell },
    { label:"AI 업무 세분화", icon:Sparkles },
  ],
  inprogress: [
    { label:"완료로 이동", icon:CheckCircle2, primary:true },
    { label:"블로커 등록", icon:AlertTriangle, danger:true },
    { label:"PR 연결", icon:GitPullRequest },
    { label:"진행상황 요청", icon:Bell },
    { label:"AI 지연 분석", icon:Sparkles },
  ],
  blocked: [
    { label:"블로커 해결 완료", icon:CheckCircle2, primary:true },
    { label:"긴급 알림", icon:Bell, danger:true },
    { label:"담당자 재배정", icon:User },
    { label:"AI 해결안 보기", icon:Sparkles },
    { label:"영향 업무 확인", icon:AlertCircle },
  ],
  done: [
    { label:"검수 완료", icon:CheckCheck, primary:true },
    { label:"팀장 피드백", icon:MessageSquare },
    { label:"결과물 보기", icon:Eye },
    { label:"AI 완료 요약", icon:Sparkles },
  ],
};

const HIDDEN_ACTION_LABELS = new Set([
  "결과물 보기", "AI 완료 요약",
  "AI 업무 세분화", "AI 지연 분석", "AI 해결안 보기", // 실제 LLM 연동 없음
  "PR 연결", // GitHub 연동 범위 밖
  "영향 업무 확인", // 업무 간 의존관계 데이터 모델 없음
  "체크리스트 생성", // "체크리스트 자동 생성"과 기능 중복
]);
// 백엔드(TaskController.sendNudge)가 넛지류를 팀장 전용(@PreAuthorize hasRole LEADER)으로 막아서 프론트도 맞춘다.
// 담당자 변경/재배정도 담당자 본인의 카드에서는 의미가 없으므로(자기 자신을 재배정할 일이 없음) 팀장 전용으로 둔다.
const LEADER_ONLY_LABELS = new Set(["팀장 피드백", "시작 알림", "진행상황 요청", "긴급 알림", "담당자 변경", "담당자 재배정"]);

// 보조 액션 중 상태를 실제로 옮기는 것들(QUICK_MOVE 키와 동일) — 백엔드 updatePosition의
// FORBIDDEN_NOT_OWNER 규칙과 맞춰, 팀장이 아니면 본인이 담당자인 업무에서만 보여준다.
const STATUS_CHANGE_SECONDARY_LABELS = new Set(["블로커 등록"]);

/** 점세개 메뉴에 실제로 보여줄 보조 액션만 남긴다(범위 밖 기능 숨김 + 팀장 전용/담당자 전용 항목 권한 필터링). */
export function visibleSecondaryActions(actions: StatusAction[], isLeader: boolean, isAssignee: boolean): StatusAction[] {
  return actions.filter((a) => {
    if (HIDDEN_ACTION_LABELS.has(a.label)) return false;
    if (LEADER_ONLY_LABELS.has(a.label) && !isLeader) return false;
    if (STATUS_CHANGE_SECONDARY_LABELS.has(a.label) && !isLeader && !isAssignee) return false;
    return true;
  });
}

/**
 * 백엔드 이동 권한 규칙(TaskController.updatePosition의 FORBIDDEN_NOT_OWNER)과 동일하게,
 * 팀장은 전체 업무를 이동할 수 있고 팀원은 자기가 담당자인 업무만 이동할 수 있다.
 */
export function canMoveTask(isLeader: boolean, task: Task, userId: number | null | undefined): boolean {
  if (isLeader) return true;
  if (userId == null) return false;
  return task.assignee === String(userId);
}

const QUICK_MOVE: Partial<Record<string, Partial<Record<TaskStatus, TaskStatus>>>> = {
  "블로커 등록": { inprogress: "blocked" },
};

/** primary CTA와 무관하게 라벨 자체가 상태 이동을 의미하는 보조 액션의 목적지 상태. 해당 없으면 null(다른 핸들러가 처리). */
export function quickMoveTargetStatus(label: string, status: TaskStatus): TaskStatus | null {
  return QUICK_MOVE[label]?.[status] ?? null;
}

/** taskId+목적지 상태 조합을 키로 묶는다. 같은 업무라도 목적지가 다르면 서로 다른 가드로 취급한다. */
function moveKey(taskId: string, targetStatus: TaskStatus): string {
  return `${taskId}:${targetStatus}`;
}

/**
 * 같은 업무를 같은 목적지 상태로 옮기는 중복 요청을 한 번만 실행한다.
 * 첫 요청이 끝나기 전에 들어온 동일 (업무, 목적지) 후속 호출은 false를 반환하고 action을 실행하지 않는다.
 *
 * 목적지가 다르면(예: 첫 요청이 아직 끝나지 않았는데 사용자가 다른 컬럼으로 다시 드래그) 폐기하지
 * 않고 그대로 실행한다 - taskId만으로 잠그면 사용자가 마음을 바꿔 다른 상태로 옮긴 의도된 조작까지
 * 조용히 사라진다. 이 함수가 막으려는 건 체크리스트 자동 완료 등으로 같은 이동이 중복 호출되는
 * 경우뿐이다.
 */
export async function runTaskMoveOnce(
  movingMoves: Set<string>,
  taskId: string,
  targetStatus: TaskStatus,
  action: () => Promise<void>,
): Promise<boolean> {
  const key = moveKey(taskId, targetStatus);
  if (movingMoves.has(key)) return false;
  movingMoves.add(key);
  try {
    await action();
    return true;
  } finally {
    movingMoves.delete(key);
  }
}
