import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Check, MoreHorizontal, ChevronDown, Trash2, Pencil, Plus } from "lucide-react";
import { CatTag } from "./CatTag";
import { TaskStatusPill } from "./TaskStatusPill";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "../../global/component/LabelBadge";
import { getCat, formatDueDate } from "../libs/utils/taskService";
import { getCatFieldValues } from "../libs/utils/catFields";
import { STATUS_ACTIONS, visibleSecondaryActions } from "../libs/utils/taskActions";
import { PARTICIPANT_COLORS } from "../../global/lib/mock/members";
import type { MemberResponse } from "../../global/api/projectsApi";
import { fetchChecklist, createChecklistItem, updateChecklistItem, deleteChecklistItem } from "../libs/utils/checklistApi";
import { fetchTaskComments, createTaskComment, updateTaskComment, deleteTaskComment, type TaskCommentDto } from "../libs/utils/taskCommentApi";
import { fetchTaskActivity, type TaskActivityDto } from "../libs/utils/activityApi";
import { DEMO_PROJECT_ID, sendTaskNudge, type NudgeKind } from "../libs/utils/taskApi";
import { useAuth } from "../../global/hooks/useAuth";
import type { Task, ChecklistItem } from "../libs/types/task";
import ChecklistGenerateModal from "./ChecklistGenerateModal";

type FeedType = "comment" | "status" | "system";
interface FeedItem { id: string; type: FeedType; who: string; when: string; msg: string; at: number; commentId?: string; isFeedback?: boolean; }

const DOT_COLOR: Record<FeedType, string> = {
  comment: "#3B5BDB",
  status: "#64748B",
  system: "#9CA3AF",
};

// 활동 로그의 type은 저장/필터링용 세분류라, 화면 점 색깔은 3가지로만 단순화해서 보여준다.
const ACTIVITY_TYPE_TO_FEED_TYPE: Record<string, FeedType> = {
  STATUS_CHANGED: "status",
  TASK_CREATED: "system",
  TASK_UPDATED: "system",
  TASK_DELETED: "system",
  ASSIGNEE_CHANGED: "system",
  CHECKLIST_CREATED: "system",
  CHECKLIST_COMPLETED: "system",
  COMPLETION_REQUESTED: "status",
  COMPLETION_APPROVED: "status",
  COMPLETION_REJECTED: "status",
  COMPLETION_CANCELLED: "status",
};

// timeZone을 명시하지 않으면 뷰어의 OS/브라우저 타임존 기준으로 표시되어, 한국 밖에서 보면 시각이 어긋난다.
// 이 앱은 한국 팀 전용이라 항상 KST로 고정해서 보여준다.
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
}

// 마감일까지 남은/지난 일수를 실제로 계산한다(예전엔 모든 업무에 "D-8"이 고정으로 찍혀 있었음).
function formatDDay(iso: string): string | null {
  if (!iso) return null;
  const due = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "D-day";
  return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
}

// 아직 실제로 동작하지 않는 버튼임을 명확히 표시한다(눌러보기 전에 미리 알 수 있도록).
function WipBadge() {
  return <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">준비 중</span>;
}

// 담당자 변경은 별도 UI를 새로 만들지 않고 이미 있는 "업무 수정" 모달로 보낸다(담당자 필드가 거기 이미 있음).
const ASSIGNEE_ACTION_LABELS = new Set(["담당자 변경", "담당자 재배정"]);

// 알림류는 별도 입력 없이 정형화된 메시지를 담당자에게 즉시 보내는 원클릭 액션이다.
// 실제 메시지 문구는 백엔드(TaskController.NUDGE_MESSAGE_TEMPLATES)가 구성한다.
const NUDGE_KINDS: Record<string, NudgeKind> = {
  "시작 알림": "START",
  "진행상황 요청": "PROGRESS",
  "긴급 알림": "URGENT",
};

const IMPLEMENTED_ACTION_LABELS = new Set([
  "팀장 피드백", "블로커 등록",
  ...ASSIGNEE_ACTION_LABELS,
  ...Object.keys(NUDGE_KINDS),
]);

interface TaskDetailPanelProps {
  task: Task;
  projectMembers: MemberResponse[];
  onClose: () => void;
  onQuickAction: (label: string, isPrimary: boolean) => void;
  onShowToast: (message: string) => void;
  onDeleteTask: (taskId: string) => void;
  onEditTask: () => void;
  onOpenWorkResult: () => void;
  onCancelCompletionRequest: () => void;
  /** 완료 승인 화면 등 작업 내용 작성 버튼이 의미가 없는 곳에서 숨긴다. 기본값은 표시(true). */
  showWorkResultButton?: boolean;
}

export function TaskDetailPanel({ task, projectMembers, onClose, onQuickAction, onShowToast, onDeleteTask, onEditTask, onOpenWorkResult, onCancelCompletionRequest, showWorkResultButton = true }: TaskDetailPanelProps) {
  const { currentProjectId, currentProject, user } = useAuth();
  const projectId = currentProjectId ?? DEMO_PROJECT_ID;
  const isLeader = currentProject?.role === "팀장";
  const isAssignee = user != null && task.assignee === String(user.id);
  // 팀장이거나 담당자 본인만 이 업무의 체크리스트/작업내용/첨부파일 등을 수정할 수 있다.
  const canEditChecklist = isLeader || isAssignee;
  const [devInfoOpen, setDevInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentSentMessage, setCommentSentMessage] = useState<string | null>(null);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistState, setChecklistState] = useState<"loading" | "ready" | "error">("loading");
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [taskComments, setTaskComments] = useState<TaskCommentDto[]>([]);
  const [commentsState, setCommentsState] = useState<"loading" | "ready" | "error">("loading");
  const [sendingComment, setSendingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const [activity, setActivity] = useState<TaskActivityDto[]>([]);
  const [activityState, setActivityState] = useState<"loading" | "ready" | "error">("loading");

  // task.id가 바뀔 때만(=다른 업무를 열 때만) 패널 UI 상태를 초기화하고 체크리스트/코멘트를 새로 불러온다.
  useEffect(() => {
    setDevInfoOpen(false);
    setMenuOpen(false);
    setConfirmingDelete(false);
    setNewComment("");
    setCommentSentMessage(null);
    setFeedbackMode(false);
    setNewItemTitle("");
    setEditingItemId(null);
    setEditingCommentId(null);

    let cancelled = false;
    setChecklistState("loading");
    fetchChecklist(task.id, projectId)
      .then((items) => {
        if (!cancelled) {
          setChecklist(items);
          setChecklistState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setChecklistState("error");
      });

    setCommentsState("loading");
    fetchTaskComments(task.id, projectId)
      .then((items) => {
        if (!cancelled) {
          setTaskComments(items);
          setCommentsState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setCommentsState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // task 객체 자체가 바뀔 때마다(패널을 열어둔 채로 상태변경/수정을 해도) 활동 로그를 다시 불러온다.
  useEffect(() => {
    let cancelled = false;
    setActivityState("loading");
    fetchTaskActivity(task.id, projectId)
      .then((items) => {
        if (!cancelled) {
          setActivity(items);
          setActivityState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setActivityState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [task]);

  const handleToggleChecklistItem = async (itemId: string) => {
    const target = checklist.find((c) => c.id === itemId);
    if (!target) return;
    const prev = checklist;
    const willBeDone = !target.done;
    setChecklist((cur) => cur.map((c) => (c.id === itemId ? { ...c, done: willBeDone } : c)));
    try {
      await updateChecklistItem(task.id, itemId, { done: willBeDone }, projectId);
      // 담당자가 체크리스트를 하나라도 체크하면, 아직 시작 전(할 일)이던 업무를 자동으로 진행 중으로 옮긴다.
      if (willBeDone && isAssignee && task.status === "todo") {
        onQuickAction("진행 중으로 이동", true);
      }
    } catch {
      setChecklist(prev);
      onShowToast("체크리스트 변경에 실패했습니다.");
    }
  };

  const handleAddChecklistItem = async () => {
    const title = newItemTitle.trim();
    if (!title || addingItem) return;
    setAddingItem(true);
    try {
      const created = await createChecklistItem(task.id, title, projectId);
      setChecklist((cur) => [...cur, created]);
      setNewItemTitle("");
    } catch {
      onShowToast("체크리스트 추가에 실패했습니다.");
    } finally {
      setAddingItem(false);
    }
  };

  const handleSendNudge = async (label: string) => {
    const kind = NUDGE_KINDS[label];
    if (!kind) return;
    try {
      await sendTaskNudge(task.id, kind, projectId);
      onShowToast(`${label}을 보냈습니다.`);
    } catch {
      onShowToast(`${label} 전송에 실패했습니다.`);
    }
  };

  const handleStartEditChecklistItem = (item: ChecklistItem) => {
    setEditingItemId(item.id);
    setEditingText(item.label);
  };

  const handleSaveEditChecklistItem = async () => {
    const itemId = editingItemId;
    const title = editingText.trim();
    if (!itemId) return;
    if (!title) {
      setEditingItemId(null);
      return;
    }
    const prev = checklist;
    setChecklist((cur) => cur.map((c) => (c.id === itemId ? { ...c, label: title } : c)));
    setEditingItemId(null);
    try {
      await updateChecklistItem(task.id, itemId, { title }, projectId);
    } catch {
      setChecklist(prev);
      onShowToast("체크리스트 수정에 실패했습니다.");
    }
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    const prev = checklist;
    setChecklist((cur) => cur.filter((c) => c.id !== itemId));
    try {
      await deleteChecklistItem(task.id, itemId, projectId);
    } catch {
      setChecklist(prev);
      onShowToast("체크리스트 삭제에 실패했습니다.");
    }
  };

  const taskCat = task.category;
  const catDef = getCat(taskCat);
  const dday = formatDDay(task.dueDate);
  const doneCount = checklist.filter((c) => c.done).length;
  const progressPct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;
  const m = projectMembers.find((me) => String(me.userId) === task.assignee);
  const actions = STATUS_ACTIONS[task.status] ?? [];
  // done 상태는 "다음 상태"가 없으므로 큰 primary CTA를 아예 보여주지 않는다("검수 완료"가
  // 실제로는 재오픈과 동일한 동작을 하던 버그가 있었는데, 재오픈 기능 자체를 없앴다).
  // 팀장이 아니면 본인이 담당자인 업무에서만 상태 이동 버튼을 보여준다(백엔드 FORBIDDEN_NOT_OWNER와 동일 규칙).
  const primaryAction = task.status === "done" || (!isLeader && !isAssignee) ? undefined : actions.find((a) => a.primary);
  // 팀원이 "완료로 이동"을 누르면 실제로는 팀장 승인을 요청하는 것이므로 버튼 문구를 다르게 보여준다.
  const primaryActionLabel = !isLeader && primaryAction?.label === "완료로 이동" ? "승인 신청" : primaryAction?.label;
  const secondaryActions = visibleSecondaryActions(actions.filter((a) => !a.primary), isLeader, isAssignee);
  const catFields = getCatFieldValues(taskCat, task.extraFields);

  // 코멘트 영역과 상태변경/수정 이력 영역을 분리해서 보여준다(더미 항목 없이 실제 기록만).
  // 코멘트 작성 자체는 taskComments가 이미 기록이라, 백엔드는 별도로 "코멘트 작성" 활동을 남기지 않는다(중복 방지).
  const commentFeedItems: FeedItem[] = taskComments.map((c): FeedItem => ({
    id: `comment-${c.id}`,
    commentId: c.id,
    type: "comment",
    who: c.authorName,
    when: formatTimestamp(c.createdAt),
    msg: c.content,
    at: new Date(c.createdAt).getTime(),
    isFeedback: c.type === "FEEDBACK",
  })).sort((x, y) => y.at - x.at);

  const historyFeedItems: FeedItem[] = activity.map((a): FeedItem => ({
    id: a.id,
    type: ACTIVITY_TYPE_TO_FEED_TYPE[a.type] ?? "system",
    who: a.actorName,
    when: formatTimestamp(a.createdAt),
    msg: a.message,
    at: new Date(a.createdAt).getTime(),
  })).sort((x, y) => y.at - x.at);

  const handleSendComment = async () => {
    const text = newComment.trim();
    if (!text || sendingComment) return;
    setSendingComment(true);
    const type = feedbackMode ? "FEEDBACK" : "COMMENT";
    try {
      const created = await createTaskComment(task.id, text, projectId, type);
      setTaskComments((cur) => [...cur, created]);
      // 담당자 알림은 이제 백엔드(TaskCommentController)가 코멘트 저장 시 함께 만든다.
      setNewComment("");
      setFeedbackMode(false);
      setCommentSentMessage(type === "FEEDBACK" ? "피드백 전송 완료" : "코멘트 전송 완료");
      setTimeout(() => setCommentSentMessage(null), 2200);
    } catch {
      onShowToast(type === "FEEDBACK" ? "피드백 전송에 실패했습니다." : "코멘트 전송에 실패했습니다.");
    } finally {
      setSendingComment(false);
    }
  };

  const handleStartEditComment = (item: FeedItem) => {
    if (!item.commentId) return;
    setEditingCommentId(item.commentId);
    setEditingCommentText(item.msg);
  };

  const handleSaveEditComment = async () => {
    const commentId = editingCommentId;
    const text = editingCommentText.trim();
    if (!commentId) return;
    if (!text) {
      setEditingCommentId(null);
      return;
    }
    const prev = taskComments;
    setTaskComments((cur) => cur.map((c) => (c.id === commentId ? { ...c, content: text } : c)));
    setEditingCommentId(null);
    try {
      await updateTaskComment(task.id, commentId, text, projectId);
    } catch {
      setTaskComments(prev);
      onShowToast("코멘트 수정에 실패했습니다.");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const prev = taskComments;
    setTaskComments((cur) => cur.filter((c) => c.id !== commentId));
    try {
      await deleteTaskComment(task.id, commentId, projectId);
    } catch {
      setTaskComments(prev);
      onShowToast("코멘트 삭제에 실패했습니다.");
    }
  };

  return (
    <div className="w-full h-full bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-start justify-between mb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <CatTag catId={taskCat} />
            <TaskStatusPill status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          <div className="relative flex items-center gap-1 shrink-0">
            {isLeader && (
              <button onClick={onEditTask} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="업무 수정">
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {showWorkResultButton && (
              <button onClick={onOpenWorkResult} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="작업 내용 작성">
                <Plus className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {(isLeader || isAssignee) && (
              <button onClick={() => setMenuOpen((o) => !o)} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="더보기">
                <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
            {(isLeader || isAssignee) && menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-52 bg-card border border-border rounded-xl shadow-lg py-1.5">
                  {secondaryActions.map((a) => {
                    const Icon = a.icon;
                    const isImplemented = IMPLEMENTED_ACTION_LABELS.has(a.label);
                    return (
                      <button
                        key={a.label}
                        onClick={() => {
                          if (a.label === "팀장 피드백") {
                            setFeedbackMode(true);
                            setMenuOpen(false);
                            commentTextareaRef.current?.focus();
                            return;
                          }
                          if (ASSIGNEE_ACTION_LABELS.has(a.label)) {
                            setMenuOpen(false);
                            onEditTask();
                            return;
                          }
                          if (a.label in NUDGE_KINDS) {
                            setMenuOpen(false);
                            handleSendNudge(a.label);
                            return;
                          }
                          onQuickAction(a.label, false);
                          setMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium hover:bg-muted text-left transition-colors ${a.danger ? "text-red-600" : "text-foreground"}`}
                      >
                        <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" />{a.label}</span>
                        {!isImplemented && <WipBadge />}
                      </button>
                    );
                  })}
                  {canEditChecklist && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => { setMenuOpen(false); setGenerateModalOpen(true); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted text-left transition-colors"
                        style={{ color: "#7048E8" }}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        체크리스트 자동 생성
                      </button>
                    </>
                  )}
                  {isLeader && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => { setMenuOpen(false); setConfirmingDelete(true); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted text-left transition-colors text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />업무 삭제
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="text-sm font-bold text-foreground leading-snug">{task.title}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{task.description}</div>
        )}
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{task.id}</div>
      </div>

      {confirmingDelete && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setConfirmingDelete(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
              <div className="text-sm font-bold text-foreground mb-1.5">업무를 삭제할까요?</div>
              <div className="text-xs text-muted-foreground mb-4">'{task.title}' 업무를 삭제하면 되돌릴 수 없습니다.</div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => { setConfirmingDelete(false); onDeleteTask(task.id); }}
                  className="px-4 py-2 text-xs font-semibold text-white rounded-xl bg-red-600 hover:bg-red-700 transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <ChecklistGenerateModal
        taskId={task.id}
        projectId={projectId}
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        onApplied={(items) => setChecklist((cur) => [...cur, ...items])}
        onShowToast={onShowToast}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* 담당자 / 시작일 / 마감일 */}
        <div className="p-4 border-b border-border grid grid-cols-3 gap-3">
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">담당자</div>
            <div className="flex items-center gap-1.5">
              {m ? (
                <>
                  <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length] }}>
                    {m.name.slice(0, 1)}
                  </div>
                  <span className="text-xs font-semibold text-foreground">{m.name}</span>
                </>
              ) : (
                <span className="text-xs font-medium text-amber-600">미배정</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">시작일</div>
            <div className="text-xs font-semibold text-foreground">{formatDueDate(task.startDate)}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">마감일</div>
            <div className="text-xs font-semibold text-foreground">
              {formatDueDate(task.dueDate)} {dday && <span className={dday.startsWith("D+") ? "text-red-600" : "text-amber-600"}>{dday}</span>}
            </div>
          </div>
        </div>

        {/* 체크리스트 + 진행률 + 주요 액션 */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-muted-foreground">체크리스트 {doneCount}/{checklist.length}</span>
            <span className="text-[11px] font-bold text-emerald-600">{progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          {checklistState === "loading" && <div className="text-xs text-muted-foreground py-1">불러오는 중...</div>}
          {checklistState === "error" && <div className="text-xs text-red-600 py-1">체크리스트를 불러오지 못했습니다.</div>}
          {checklistState === "ready" && checklist.length === 0 && (
            <div className="text-xs text-muted-foreground py-1">체크리스트가 없습니다. 아래에서 추가해보세요.</div>
          )}
          {checklistState === "ready" && checklist.map((item) => (
            <div key={item.id} className="group flex items-center gap-2 py-1">
              <div
                onClick={canEditChecklist ? () => handleToggleChecklistItem(item.id) : undefined}
                className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${canEditChecklist ? "cursor-pointer" : "cursor-default"} ${item.done ? "bg-emerald-500 border-emerald-500" : "border-border hover:border-blue-400"}`}
              >
                {item.done && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              {canEditChecklist && editingItemId === item.id ? (
                <input
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={handleSaveEditChecklistItem}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEditChecklistItem();
                    if (e.key === "Escape") setEditingItemId(null);
                  }}
                  className="flex-1 text-xs rounded border border-blue-300 px-1.5 py-0.5 outline-none"
                />
              ) : (
                <span
                  onClick={canEditChecklist ? () => handleStartEditChecklistItem(item) : undefined}
                  className={`flex-1 text-xs ${canEditChecklist ? "cursor-text" : "cursor-default"} ${item.done ? "line-through text-muted-foreground" : "text-foreground"}`}
                >
                  {item.label}
                </span>
              )}
              {canEditChecklist && (
                <button
                  onClick={() => handleDeleteChecklistItem(item.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                >
                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          ))}
          {checklistState === "ready" && canEditChecklist && (
            <div className="flex items-center gap-1.5 mt-2">
              <input
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddChecklistItem(); }}
                placeholder="체크리스트 항목 추가"
                className="flex-1 text-xs rounded-lg border border-border bg-input-background px-2.5 py-1.5 outline-none focus:border-blue-400"
              />
              <button
                onClick={handleAddChecklistItem}
                disabled={!newItemTitle.trim() || addingItem}
                className="shrink-0 p-1.5 rounded-lg text-white disabled:opacity-40 transition-opacity"
                style={{ background: "var(--primary)" }}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {task.pendingApproval ? (
            <div className="mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-xs font-semibold text-amber-700">승인 대기중 · 팀장 확인을 기다리고 있어요</div>
              {isAssignee && (
                <button
                  onClick={onCancelCompletionRequest}
                  className="mt-2 w-full py-2 text-xs font-semibold rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  신청 취소
                </button>
              )}
            </div>
          ) : primaryAction && (
            <button
              onClick={() => onQuickAction(primaryAction.label, true)}
              className="w-full flex items-center justify-center gap-1.5 mt-3 py-2.5 text-xs font-semibold rounded-xl text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
            >
              {primaryActionLabel}<primaryAction.icon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 개발 정보 아코디언 */}
        <div className="p-4 border-b border-border">
          <button
            onClick={() => setDevInfoOpen((o) => !o)}
            className="w-full flex items-center justify-between border border-border rounded-xl px-3 py-2.5 hover:bg-muted transition-colors"
          >
            <span className="text-xs font-bold text-foreground">{catDef.label} 정보</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${devInfoOpen ? "" : "-rotate-90"}`} />
          </button>
          {devInfoOpen && (
            <div className="mt-2 bg-muted/40 rounded-xl p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-muted-foreground w-16 shrink-0 pt-0.5">레이블</span>
                <div className="flex flex-wrap gap-1 flex-1">{task.labels.map((l) => <LabelBadge key={l} label={l} />)}</div>
              </div>
              {catFields.map(([label, value]) => (
                <div key={label} className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground w-16 shrink-0 pt-0.5">{label}</span>
                  <span className="text-xs font-medium text-foreground flex-1 break-words leading-relaxed">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 코멘트 */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">코멘트</span>
          </div>
          <div className="text-[9.5px] text-muted-foreground mb-3">팀원과 주고받은 코멘트·피드백입니다.</div>

          {commentsState === "loading" && <div className="text-xs text-muted-foreground py-2">불러오는 중...</div>}
          {commentsState === "error" && <div className="text-xs text-red-600 py-2">코멘트를 불러오지 못했습니다.</div>}
          {commentsState === "ready" && commentFeedItems.length === 0 && (
            <div className="text-xs text-muted-foreground py-2">아직 코멘트가 없습니다.</div>
          )}
          {commentsState === "ready" && commentFeedItems.map((item) => (
            <div key={item.id} className="group flex gap-2.5 mb-3 last:mb-0">
              <div className="pt-1.5 shrink-0">
                <span className="block w-1.5 h-1.5 rounded-full" style={{ background: DOT_COLOR[item.type] }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">{item.who}</span>
                  {item.isFeedback && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(112,72,232,0.12)", color: "#7048E8" }}>
                      피드백
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{item.when}</span>
                  {item.commentId && (
                    <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleStartEditComment(item)} className="p-0.5 rounded hover:bg-muted">
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDeleteComment(item.commentId!)} className="p-0.5 rounded hover:bg-muted">
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </span>
                  )}
                </div>
                {editingCommentId === item.commentId ? (
                  <textarea
                    autoFocus
                    value={editingCommentText}
                    onChange={(e) => setEditingCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEditComment(); }
                      if (e.key === "Escape") setEditingCommentId(null);
                    }}
                    rows={2}
                    className="w-full mt-1 text-xs rounded-lg border border-blue-300 px-2 py-1.5 outline-none resize-none"
                  />
                ) : (
                  <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.msg}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 상태변경/수정 이력 */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">상태변경 및 수정 이력</span>
          </div>
          <div className="text-[9.5px] text-muted-foreground mb-3">이 업무에서 실제로 일어난 상태변경·수정 기록입니다(읽기 전용).</div>

          {activityState === "loading" && <div className="text-xs text-muted-foreground py-2">불러오는 중...</div>}
          {activityState === "error" && <div className="text-xs text-red-600 py-2">활동 기록을 불러오지 못했습니다.</div>}
          {activityState === "ready" && historyFeedItems.length === 0 && (
            <div className="text-xs text-muted-foreground py-2">아직 활동 내역이 없습니다.</div>
          )}
          {activityState === "ready" && historyFeedItems.map((item) => (
            <div key={item.id} className="flex gap-2.5 mb-3 last:mb-0">
              <div className="pt-1.5 shrink-0">
                <span className="block w-1.5 h-1.5 rounded-full" style={{ background: DOT_COLOR[item.type] }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">{item.who}</span>
                  <span className="text-[10px] text-muted-foreground">{item.when}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.msg}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 댓글 입력 (하단 고정) */}
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={commentTextareaRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); }
            }}
            rows={2}
            placeholder={feedbackMode ? "팀장 피드백을 남기세요... (Shift+Enter: 줄바꿈)" : "팀원에게 코멘트를 남기세요... (Shift+Enter: 줄바꿈)"}
            className={`flex-1 text-xs rounded-lg border ${feedbackMode ? "border-purple-300" : "border-border"} bg-input-background px-3 py-2 outline-none focus:border-blue-400 resize-none`}
          />
          <button onClick={handleSendComment} disabled={!newComment.trim() || sendingComment} className="self-end p-2 rounded-lg text-white shrink-0 disabled:opacity-40" style={{ background: "var(--primary)" }}>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        {commentSentMessage && <div className="text-[10px] text-emerald-600 mt-1.5">{commentSentMessage}</div>}
      </div>
    </div>
  );
}
