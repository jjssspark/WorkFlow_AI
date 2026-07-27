import { updateTaskPosition, updateTask, deleteTask } from "../../../board/libs/utils/taskApi";
import { createTaskComment } from "../../../board/libs/utils/taskCommentApi";
import { fetchChecklist, updateChecklistItem } from "../../../board/libs/utils/checklistApi";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";
import type { TaskStatus } from "../../../board/libs/types/task";
import type { ActionCard } from "../types/command";

export interface ExecutionResult {
  ok: boolean;
  error?: string;
}

const VALID_STATUSES: TaskStatus[] = ["todo", "inprogress", "blocked", "done"];

// tasks.title은 VARCHAR(200)이다. 그래프(state.py _TITLE_MAX_LENGTH)와 같은 값이라야
// 계획 단계를 통과한 제목이 여기서 다시 거부되지 않는다.
const TITLE_MAX_LENGTH = 200;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

// 형식(YYYY-MM-DD)뿐 아니라 실제 존재하는 날짜인지 확인한다(예: 2026-99-99, 2026-02-30 거부).
function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 담당자 이름을 프로젝트 멤버 한 명으로 좁힌다.
 *
 * 카드는 사용자가 말한 이름("김철수")만 담고 있고 업무 수정 API는 id를 요구하므로, 멤버
 * 목록을 받아 여기서 해소한다. 정확히 한 명으로 좁혀지지 않으면 실행하지 않는다 - 엉뚱한
 * 사람에게 업무를 넘기는 것이 되묻는 것보다 훨씬 나쁘다.
 *
 * 정확 일치가 여러 건일 수 있다(동명이인). 그때 첫 번째를 고르면 조용히 틀린 사람에게
 * 배정되므로, 정확 일치도 1건일 때만 확정한다.
 */
function resolveMember(
  members: readonly MemberResponse[],
  name: string
): { ok: true; member: MemberResponse } | { ok: false; error: string } {
  const exact = members.filter(member => member.name.trim() === name);
  const matches = exact.length > 0 ? exact : members.filter(member => member.name.includes(name));

  if (matches.length === 0) {
    return { ok: false, error: `'${name}' 담당자를 프로젝트 멤버에서 찾지 못했습니다.` };
  }
  if (matches.length > 1) {
    return { ok: false, error: "이름이 겹치는 멤버가 여러 명입니다. 더 구체적으로 말씀해주세요." };
  }
  return { ok: true, member: matches[0] };
}

/**
 * 확인 카드를 기존 업무보드 API 호출로 옮긴다.
 *
 * DB를 바꾸는 경로는 여기 하나뿐이고, 전부 화면에서 쓰는 것과 동일한 함수를 부른다.
 * 따라서 권한 검사·활동 로그·알림·RAG 동기화가 자동으로 유지되고, AI 전용 쓰기 경로는 없다.
 */
export async function executeAction(card: ActionCard, projectId: number): Promise<ExecutionResult> {
  if (card.taskId == null) {
    return { ok: false, error: "대상 업무가 지정되지 않았습니다." };
  }
  const taskId = String(card.taskId);

  try {
    switch (card.tool) {
      case "change_status": {
        const to = String(card.args.to ?? "");
        if (!VALID_STATUSES.includes(to as TaskStatus)) {
          return { ok: false, error: "알 수 없는 상태입니다." };
        }
        // 칸반 position은 드래그앤드롭용 정렬값이다. AI 경로는 순서를 지정하지 않으므로
        // 실행 시점 타임스탬프로 목록 끝에 붙인다(호출마다 값이 달라 정렬 충돌을 피한다).
        await updateTaskPosition(taskId, to as TaskStatus, Date.now(), projectId);
        return { ok: true };
      }
      case "add_comment": {
        const content = String(card.args.content ?? "").trim();
        if (!content) return { ok: false, error: "코멘트 내용이 비어 있습니다." };
        await createTaskComment(taskId, content, projectId);
        return { ok: true };
      }
      case "toggle_checklist": {
        const itemText = String(card.args.item ?? "").trim();
        // 빈 문자열이면 label.includes("")가 항상 참이 되어 첫 항목을 잘못 토글한다.
        if (!itemText) return { ok: false, error: "체크리스트 항목이 지정되지 않았습니다." };
        const done = card.args.done === true;
        const items = await fetchChecklist(taskId, projectId);
        // 정확히 같은 항목을 우선한다. 없으면 부분 일치로 넓히되, 여러 개면 되묻는다
        // (유사 항목이 있을 때 첫 번째를 임의로 바꾸지 않기 위해서다).
        const exact = items.find(item => item.label.trim() === itemText);
        const matches = exact ? [exact] : items.filter(item => item.label.includes(itemText));
        if (matches.length === 0) return { ok: false, error: "해당 체크리스트 항목을 찾지 못했습니다." };
        if (matches.length > 1) {
          return { ok: false, error: "일치하는 체크리스트 항목이 여러 개입니다. 더 구체적으로 말씀해주세요." };
        }
        await updateChecklistItem(taskId, matches[0].id, { done }, projectId);
        return { ok: true };
      }
      case "set_due_date": {
        const date = String(card.args.date ?? "").trim();
        // 그래프(state.py)와 같은 형식·달력 검증. 백엔드를 우회한 잘못된 값이 나가지 않게 한다.
        if (!isValidCalendarDate(date)) {
          return { ok: false, error: "마감일이 올바른 날짜가 아닙니다." };
        }
        await updateTask(taskId, { dueDate: date }, projectId);
        return { ok: true };
      }
      case "rename_task": {
        const title = String(card.args.title ?? "").trim();
        if (!title) return { ok: false, error: "새 제목이 비어 있습니다." };
        // 그래프(state.py)와 같은 길이 검증. 백엔드를 우회한 값이 DB 제약에 걸려
        // 원인 모를 500으로 보이지 않게 한다.
        if (title.length > TITLE_MAX_LENGTH) {
          return { ok: false, error: `제목이 너무 깁니다(${TITLE_MAX_LENGTH}자 이내).` };
        }
        await updateTask(taskId, { title }, projectId);
        return { ok: true };
      }
      case "change_assignee": {
        const name = String(card.args.assignee_name ?? "").trim();
        // 빈 이름이면 members.includes("")가 모두 참이라 아무나 걸린다.
        if (!name) return { ok: false, error: "담당자 이름이 지정되지 않았습니다." };
        const resolved = resolveMember(await getProjectMembers(projectId), name);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        await updateTask(taskId, { assigneeId: String(resolved.member.userId) }, projectId);
        return { ok: true };
      }
      case "delete_task": {
        // 되돌릴 수 없는 유일한 도구다. 안전장치는 확인 카드뿐이므로 여기서 대상 업무를
        // 다시 좁히거나 추측하지 않는다 - 카드에 실린 task_id 그대로만 지운다.
        await deleteTask(taskId, projectId);
        return { ok: true };
      }
      default:
        // 그래프 SUPPORTED_TOOLS와 이 switch가 어긋나면 "카드는 떴는데 안 되는" 상태가 된다.
        // 도달할 일이 없어야 정상이지만, 어긋났을 때 조용히 실패하지 않도록 방어적으로 거부한다.
        return { ok: false, error: "아직 지원하지 않는 작업입니다." };
    }
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}
