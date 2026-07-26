import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Check, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CatTag } from "../components/CatTag";
import { PriorityBadge } from "../components/PriorityBadge";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { EditTaskModal } from "../components/EditTaskModal";
import {
  fetchPendingApprovalTasks, approveTaskCompletion, rejectTaskCompletion, cancelTaskCompletion,
  updateTaskPosition, deleteTask, DEMO_PROJECT_ID,
} from "../libs/utils/taskApi";
import { fetchChecklist } from "../libs/utils/checklistApi";
import { NEXT_STATUS, quickMoveTargetStatus } from "../libs/utils/taskActions";
import { formatDueDate } from "../libs/utils/taskService";
import { useAuth } from "../../global/hooks/useAuth";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import type { Task } from "../libs/types/task";

const UNASSIGNED = "__unassigned__";

export function CompletionApprovalsView() {
  const { currentProjectId } = useAuth();
  const projectId = currentProjectId ?? DEMO_PROJECT_ID;
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklistProgress, setChecklistProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  const selTask = selId ? tasks.find((t) => t.id === selId) ?? null : null;

  const loadTasks = useCallback(() => {
    setLoadState("loading");
    fetchPendingApprovalTasks(projectId)
      .then(async (result) => {
        setTasks(result);
        setLoadState("ready");
        // 목록의 각 업무 체크리스트 진행률도 같이 보여준다(행에 담당자 진행 상황을 바로 보여주기 위함).
        const entries = await Promise.all(
          result.map(async (t) => {
            try {
              const items = await fetchChecklist(t.id, projectId);
              return [t.id, { done: items.filter((i) => i.done).length, total: items.length }] as const;
            } catch {
              return [t.id, { done: 0, total: 0 }] as const;
            }
          })
        );
        setChecklistProgress(Object.fromEntries(entries));
      })
      .catch(() => setLoadState("error"));
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (currentProjectId == null) {
      setProjectMembers([]);
      return;
    }
    getProjectMembers(currentProjectId)
      .then(setProjectMembers)
      .catch(() => setProjectMembers([]));
  }, [currentProjectId]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  // 승인/반려/취소 이후엔 더 이상 대기 목록에 속하지 않으므로 로컬 목록에서 바로 제거하고,
  // 상세 패널이 그 업무를 보고 있었다면 같이 닫는다.
  const removeFromList = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelId((prev) => (prev === taskId ? null : prev));
  };

  const handleApprove = async (taskId: string) => {
    setProcessingId(taskId);
    try {
      await approveTaskCompletion(taskId, projectId);
      removeFromList(taskId);
      showToast("완료를 승인했습니다.");
    } catch {
      showToast("승인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (taskId: string) => {
    setProcessingId(taskId);
    try {
      await rejectTaskCompletion(taskId, projectId);
      removeFromList(taskId);
      showToast("완료 요청을 반려했습니다.");
    } catch {
      showToast("반려에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancelCompletionRequest = async (taskId: string) => {
    try {
      await cancelTaskCompletion(taskId, projectId);
      removeFromList(taskId);
      showToast("완료 승인 요청을 취소했습니다.");
    } catch {
      showToast("취소에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId, projectId);
      removeFromList(taskId);
      showToast("업무를 삭제했습니다.");
    } catch {
      showToast("업무 삭제에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const handleTaskUpdated = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    setEditingTask(null);
  };

  // 상세 패널의 상태 이동 액션(더보기 메뉴). 이 화면은 팀장 전용이라 항상 즉시 이동한다.
  const handleQuickAction = async (label: string, isPrimary: boolean) => {
    if (!selTask) return;
    const targetStatus = quickMoveTargetStatus(label, selTask.status) ?? (isPrimary ? NEXT_STATUS[selTask.status] : null);
    if (!targetStatus) {
      showToast("준비 중인 기능입니다.");
      return;
    }
    try {
      const updated = await updateTaskPosition(selTask.id, targetStatus, 0, projectId);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      showToast(`${label} 완료`);
    } catch {
      showToast("상태 변경에 실패했습니다. 다시 시도해주세요.");
    }
  };

  // 대기 목록에 실제로 등장하는 담당자만 필터 선택지로 보여준다.
  const assigneeOptions = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.assignee || UNASSIGNED));
    return Array.from(ids).map((id) => ({
      id,
      name: id === UNASSIGNED ? "미배정" : projectMembers.find((m) => String(m.userId) === id)?.name ?? id,
    }));
  }, [tasks, projectMembers]);

  const visibleTasks = useMemo(() => {
    if (assigneeFilter === "all") return tasks;
    return tasks.filter((t) => (t.assignee || UNASSIGNED) === assigneeFilter);
  }, [tasks, assigneeFilter]);

  return (
    <div className="h-full flex flex-col overflow-hidden relative" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      {toast && (
        <div className="fixed top-4 right-6 z-[60] px-4 py-2.5 rounded-xl text-xs font-semibold text-white shadow-lg" style={{ background: "#1C2333" }}>
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between shrink-0 border-b border-border px-5 py-3.5">
        <div>
          <h1 className="font-bold text-foreground text-base">완료 승인 대기</h1>
          <p className="text-xs text-muted-foreground mt-0.5">팀원이 완료로 옮기려는 업무를 승인하거나 반려하세요. 행을 클릭하면 상세·코멘트를 볼 수 있어요.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="text-xs rounded-lg border border-border bg-input-background px-2.5 py-1.5 outline-none focus:border-blue-400"
          >
            <option value="all">담당자 전체</option>
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
            {visibleTasks.length}건 대기중
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {loadState === "loading" && (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">불러오는 중...</div>
        )}
        {loadState === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <span>목록을 불러오지 못했습니다.</span>
            <button
              onClick={loadTasks}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
              style={{ background: "var(--primary)" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />다시 시도
            </button>
          </div>
        )}
        {loadState === "ready" && visibleTasks.length === 0 && (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            승인 대기 중인 업무가 없습니다.
          </div>
        )}
        {loadState === "ready" && visibleTasks.length > 0 && (
          <PanelGroup direction="horizontal">
            <Panel defaultSize={selTask ? 65 : 100} minSize={40} className="min-w-0">
              <div className="h-full overflow-y-auto scrollbar-thin px-5 py-4">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
                      <th className="px-4 py-2.5 font-semibold">업무</th>
                      <th className="px-3 py-2.5 font-semibold">담당자</th>
                      <th className="px-3 py-2.5 font-semibold">시작일</th>
                      <th className="px-3 py-2.5 font-semibold">마감일</th>
                      <th className="px-3 py-2.5 font-semibold">체크리스트</th>
                      <th className="px-4 py-2.5 font-semibold text-right">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => {
                      const m = projectMembers.find((me) => String(me.userId) === task.assignee);
                      const busy = processingId === task.id;
                      const selected = selId === task.id;
                      const progress = checklistProgress[task.id];
                      return (
                        <tr
                          key={task.id}
                          onClick={() => setSelId((prev) => (prev === task.id ? null : task.id))}
                          className={`border-b border-border last:border-0 cursor-pointer transition-colors ${selected ? "bg-blue-50" : "hover:bg-muted/40"}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <CatTag catId={task.category} />
                              <PriorityBadge priority={task.priority} />
                            </div>
                            <div className="text-sm font-semibold text-foreground mt-1">{task.title}</div>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{m?.name ?? "미배정"}</td>
                          <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDueDate(task.startDate)}</td>
                          <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDueDate(task.dueDate)}</td>
                          <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                            {progress ? (progress.total === 0 ? "—" : `${progress.done}/${progress.total}`) : "…"}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleReject(task.id)}
                                disabled={busy}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                              >
                                <X className="w-3 h-3" />반려
                              </button>
                              <button
                                onClick={() => handleApprove(task.id)}
                                disabled={busy}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                                style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
                              >
                                <Check className="w-3 h-3" />승인
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
            {selTask && (
              <>
                <PanelResizeHandle className="group relative w-2.5 shrink-0 flex items-center justify-center outline-none cursor-col-resize">
                  <div className="w-1 h-10 rounded-full bg-border transition-colors group-hover:bg-blue-300 group-active:bg-blue-400" />
                </PanelResizeHandle>
                <Panel defaultSize={35} minSize={26} maxSize={50} className="min-w-0">
                  <TaskDetailPanel
                    task={selTask}
                    projectMembers={projectMembers}
                    onClose={() => setSelId(null)}
                    onQuickAction={handleQuickAction}
                    onShowToast={showToast}
                    onDeleteTask={handleDeleteTask}
                    onEditTask={() => setEditingTask(selTask)}
                    onOpenWorkResult={() => showToast("결과물은 업무 보드에서 확인해주세요.")}
                    onCancelCompletionRequest={() => handleCancelCompletionRequest(selTask.id)}
                    showWorkResultButton={false}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
        )}
      </div>

      <EditTaskModal task={editingTask} projectMembers={projectMembers} onClose={() => setEditingTask(null)} onUpdated={handleTaskUpdated} />
    </div>
  );
}
