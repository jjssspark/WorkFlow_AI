export type Tab = "dashboard" | "board" | "completion-approvals" | "roadmap" | "leader" | "meetings" | "deliverables" | "github" | "contributors" | "mypage";
export type TaskStatus = "todo" | "inprogress" | "done" | "blocked";
export type Priority = "high" | "medium" | "low";
export type DetailPage = "all-tasks" | "progress" | "blockers" | "inprogress" | "dash-progress" | "urgent" | "workload" | "activity" | null;

export interface ChecklistItem { id: string; label: string; done: boolean; }

export interface Task {
  id: string; title: string; status: TaskStatus; priority: Priority;
  assignee: string;
  /** ISO 형식 YYYY-MM-DD, 비어있으면 미정. 화면 표시는 formatDueDate()로 변환해서 사용. dueDate보다 늦을 수 없음 */
  startDate: string;
  /** ISO 형식 YYYY-MM-DD. 화면 표시는 formatDueDate()로 변환해서 사용 */ dueDate: string; labels: string[];
  milestoneId?: string;
  /** 카테고리(CatId 값이면 아이콘/색상까지 적용, 아니면 CatTag가 "기타"로 표시) */
  category: string;
  /** 같은 status 안에서의 칸반 카드 순서(오름차순). 컬럼 간 값 비교는 하지 않음 */
  position: number;
  description?: string;
  sourceMeetingTitle?: string;
  /** 담당자가 완료를 요청했고 아직 팀장이 승인/반려하지 않은 상태 */
  pendingApproval: boolean;
  /** 카테고리별 추가 정보(자유 키-값). 키는 CAT_MODAL_FIELDS의 라벨과 일치 */
  extraFields: Record<string, string>;
}

export type CatId = "planning"|"research"|"ux-ui"|"design"|"frontend"|"backend"|"ai-ml"|"data"|"db"|"devops"|"github"|"qa"|"security"|"docs"|"presentation"|"deliverable"|"operation"|"other";
export interface CategoryDef { id: CatId; label: string; desc: string; icon: any; color: string; bg: string; }
