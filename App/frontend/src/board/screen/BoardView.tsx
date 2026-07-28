import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { BoardToolbar } from "../components/BoardToolbar";
import { BoardFilterBar, UNASSIGNED_FILTER_ID } from "../components/BoardFilterBar";
import { KanbanBoard } from "../components/KanbanBoard";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { TaskResultPanel } from "../components/TaskResultPanel";
import { AddTaskModal } from "../components/AddTaskModal";
import { EditTaskModal } from "../components/EditTaskModal";
import {
  fetchTasks, updateTaskPosition, deleteTask, requestTaskCompletion, cancelTaskCompletion, DEMO_PROJECT_ID,
} from "../libs/utils/taskApi";
import { NEXT_STATUS, quickMoveTargetStatus, runTaskMoveOnce, type TaskMoveQueue } from "../libs/utils/taskActions";
import { reorderTasks } from "../libs/utils/taskService";
import { useAuth } from "../../global/hooks/useAuth";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import type { Task, TaskStatus } from "../libs/types/task";

const FILTER_PARAMS = ["assignee", "priority", "category"] as const;

function parseFilterParam(searchParams: URLSearchParams, key: string): string[] {
  return searchParams.get(key)?.split(",").filter(Boolean) ?? [];
}

export function BoardView() {
  const { currentProjectId, currentProject, projectContextReady } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const projectId = currentProjectId ?? DEMO_PROJECT_ID;
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selId, setSelId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalStatus, setModalStatus] = useState<TaskStatus>("todo");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [workResultOpen, setWorkResultOpen] = useState(false);
  const [completionConfirmTaskId, setCompletionConfirmTaskId] = useState<string | null>(null);
  const taskMoveQueueRef = useRef<TaskMoveQueue>(new Map());
  // moveTask는 큐에 걸려 앞선 요청이 끝난 뒤 실행될 수 있어, 그 시점엔 useState의 tasks 클로저가
  // 오래된 값일 수 있다. 실행 시점의 최신 배열을 읽기 위한 거울(mirror) ref.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const selTask = selId ? tasks.find((t) => t.id === selId) ?? null : null;

  const assigneeFilter = useMemo(() => parseFilterParam(searchParams, "assignee"), [searchParams]);
  const priorityFilter = useMemo(() => parseFilterParam(searchParams, "priority"), [searchParams]);
  const categoryFilter = useMemo(() => parseFilterParam(searchParams, "category"), [searchParams]);

  const filteredTasks = useMemo(() => tasks.filter((t) => {
    const assigneeFilterValue = t.assignee || UNASSIGNED_FILTER_ID;
    return (assigneeFilter.length === 0 || assigneeFilter.includes(assigneeFilterValue)) &&
      (priorityFilter.length === 0 || priorityFilter.includes(t.priority)) &&
      (categoryFilter.length === 0 || categoryFilter.includes(t.category));
  }), [tasks, assigneeFilter, priorityFilter, categoryFilter]);

  const toggleFilterValue = (key: (typeof FILTER_PARAMS)[number], value: string) => {
    const current = parseFilterParam(searchParams, key);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const nextParams = new URLSearchParams(searchParams);
    if (next.length > 0) nextParams.set(key, next.join(","));
    else nextParams.delete(key);
    setSearchParams(nextParams, { replace: true });
  };

  const resetFilters = () => {
    const nextParams = new URLSearchParams(searchParams);
    FILTER_PARAMS.forEach((key) => nextParams.delete(key));
    setSearchParams(nextParams, { replace: true });
  };

  const loadTasks = useCallback(() => {
    setLoadState("loading");
    fetchTasks(projectId)
      .then((result) => {
        setTasks(result);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [projectId]);

  // 다른 팀원의 변경사항은 실시간으로 반영되지 않고, 이 화면에 새로 들어오거나 새로고침할 때만 반영된다.
  // projectId가 바뀌면(사이드바에서 프로젝트 전환) 그 프로젝트의 업무로 다시 불러온다.
  // projectContextReady가 되기 전(새로고침 직후 등)에는 currentProjectId가 아직 null이라 DEMO_PROJECT_ID로
  // 폴백해버리므로, 실제 프로젝트가 확정될 때까지 기다렸다가 불러온다 - 그렇지 않으면 새로고침 시
  // 잠깐 데모 프로젝트의 보드가 떴다가 바뀌고, 그 사이 삭제 등 액션은 데모 프로젝트로 나가 403이 난다.
  useEffect(() => {
    if (!projectContextReady) return;
    loadTasks();
  }, [loadTasks, projectContextReady]);

  // 담당자 배정 UI(카드 아바타, 상세 패널, 드롭다운, 필터)는 현재 프로젝트의 실제 멤버만 보여준다.
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

  const openModal = (status: TaskStatus) => {
    setModalStatus(status);
    setShowModal(true);
  };

  useEffect(() => {
    if (searchParams.get("openAdd") === "1") {
      if (isLeader) openModal("todo");
      const next = new URLSearchParams(searchParams);
      next.delete("openAdd");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 마이페이지의 "오늘 할 일"/"이번 주 마감"에서 넘어온 taskId — 업무 목록이 로드된 뒤 상세 패널을 연다.
  useEffect(() => {
    if (loadState !== "ready") return;
    const taskId = searchParams.get("taskId");
    if (!taskId) return;
    if (tasks.some((t) => t.id === taskId)) {
      setSelId(taskId);
      setWorkResultOpen(false);
    } else {
      showToast("삭제되었거나 현재 프로젝트에서 찾을 수 없는 업무입니다.");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("taskId");
    FILTER_PARAMS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [loadState, tasks, searchParams, setSearchParams]);

  const handleTaskCreated = (task: Task) => {
    setTasks((prev) => [task, ...prev]);
  };

  const handleTaskUpdated = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    setEditingTask(null);
  };

  // 업무를 targetStatus 컬럼의 insertAtIndex 위치로 옮긴다(같은 컬럼 안 재정렬 + 다른 컬럼으로 이동 모두 이 함수 하나로 처리).
  // 배열 재배치/position 계산 자체는 reorderTasks()에 위임하고, 여기서는 낙관적 업데이트 + API 호출 + 롤백만 담당한다.
  const moveTask = async (taskId: string, targetStatus: TaskStatus, insertAtIndex: number) => {
    // 체크리스트 여러 항목을 빠르게 완료하면 상태 prop이 갱신되기 전에 자동 이동이 연속 호출될 수 있다.
    // 동일 업무의 첫 이동 요청이 끝날 때까지 같은 목적지로의 후속 호출은 막되(중복 API/알림 방지),
    // 다른 목적지로의 요청은 버리지 않고 앞선 요청 뒤에 순서대로 실행한다(runTaskMoveOnce 참고) -
    // 그래야 서버에 도착하는 순서가 사용자가 드래그한 순서와 같아진다.
    await runTaskMoveOnce(taskMoveQueueRef.current, taskId, targetStatus, async () => {
      // 큐에 걸려 늦게 실행될 수 있으므로, 재정렬 계산은 실행 시점의 최신 배열을 기준으로 한다.
      const current = tasksRef.current;
      const dragged = current.find((t) => t.id === taskId);
      const result = reorderTasks(current, taskId, targetStatus, insertAtIndex);
      if (!dragged || !result) return;
      const prevStatus = dragged.status;
      const prevPosition = dragged.position;
      setTasks(result.next);
      try {
        await updateTaskPosition(taskId, targetStatus, result.newPosition, projectId);
      } catch {
        // 이 업무만 이동 전 상태로 되돌린다. 배열 전체를 스냅샷으로 되돌리면, 그 사이 다른 요청
        // (다른 업무이거나 이 업무의 다음 큐 항목)이 이미 반영한 성공한 변경까지 지워버린다.
        setTasks((latest) => latest.map((t) =>
          (t.id === taskId ? { ...t, status: prevStatus, position: prevPosition } : t)
        ));
        showToast("이동에 실패했습니다. 다시 시도해주세요.");
      }
    });
  };

  const handleSelectTask = (id: string) => {
    setSelId((prev) => (prev === id ? null : id));
    setWorkResultOpen(false);
  };

  // 팀원이 "완료"로 옮기려는 시도를 가로채서 확인 팝업을 띄운다. 팀장은 그대로 즉시 이동.
  const requestOrMoveToDone = (taskId: string, moveDirectly: () => void) => {
    if (isLeader) {
      moveDirectly();
      return;
    }
    setCompletionConfirmTaskId(taskId);
  };

  const handleQuickAction = (label: string, isPrimary: boolean) => {
    if (!selTask) return;
    const moveTo = quickMoveTargetStatus(label, selTask.status);
    if (moveTo) {
      const columnCount = tasks.filter((t) => t.status === moveTo && t.id !== selTask.id).length;
      moveTask(selTask.id, moveTo, columnCount);
      showToast(`${label} 완료`);
      return;
    }
    if (isPrimary) {
      const nextStatus = NEXT_STATUS[selTask.status];
      if (nextStatus) {
        const columnCount = tasks.filter((t) => t.status === nextStatus && t.id !== selTask.id).length;
        const moveDirectly = () => {
          moveTask(selTask.id, nextStatus, columnCount);
          showToast(`${label} 완료`);
        };
        if (nextStatus === "done") {
          requestOrMoveToDone(selTask.id, moveDirectly);
        } else {
          moveDirectly();
        }
        return;
      }
    }
    showToast("준비 중인 기능입니다.");
  };

  // 컬럼의 빈 영역에 드롭 = 그 컬럼 맨 끝에 추가.
  const handleDropTask = (taskId: string, status: TaskStatus) => {
    const columnCount = tasks.filter((t) => t.status === status && t.id !== taskId).length;
    const moveDirectly = () => moveTask(taskId, status, columnCount);
    if (status === "done") {
      requestOrMoveToDone(taskId, moveDirectly);
    } else {
      moveDirectly();
    }
  };

  const confirmCompletionRequest = async () => {
    const taskId = completionConfirmTaskId;
    setCompletionConfirmTaskId(null);
    if (!taskId) return;
    try {
      const updated = await requestTaskCompletion(taskId, projectId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      showToast("완료 승인을 요청했습니다.");
    } catch {
      showToast("완료 승인 요청에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const handleCancelCompletionRequest = async (taskId: string) => {
    try {
      const updated = await cancelTaskCompletion(taskId, projectId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      showToast("완료 승인 요청을 취소했습니다.");
    } catch {
      showToast("취소에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const prevTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelId((prev) => (prev === taskId ? null : prev));
    try {
      await deleteTask(taskId, projectId);
    } catch {
      setTasks(prevTasks);
      showToast("업무 삭제에 실패했습니다. 다시 시도해주세요.");
    }
  };

  // 카드를 특정 카드의 앞/뒤로 드롭 - 같은 컬럼 안 순서 변경, 다른 컬럼으로 이동 모두 여기로 들어온다.
  const handleReorderTask = (draggedId: string, targetId: string, position: "before" | "after") => {
    if (draggedId === targetId) return;
    const targetTask = tasks.find((t) => t.id === targetId);
    if (!targetTask) return;
    const columnTasks = tasks.filter((t) => t.status === targetTask.status && t.id !== draggedId);
    const targetIndex = columnTasks.findIndex((t) => t.id === targetId);
    if (targetIndex === -1) return;
    const insertAt = position === "after" ? targetIndex + 1 : targetIndex;
    const moveDirectly = () => moveTask(draggedId, targetTask.status, insertAt);
    if (targetTask.status === "done") {
      requestOrMoveToDone(draggedId, moveDirectly);
    } else {
      moveDirectly();
    }
  };

  const workspaceMode = Boolean(selTask);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full flex flex-col overflow-hidden relative" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
        {toast && (
          <div className="fixed top-4 right-6 z-[60] px-4 py-2.5 rounded-xl text-xs font-semibold text-white shadow-lg" style={{ background: "#1C2333" }}>
            {toast}
          </div>
        )}

        <BoardToolbar tasks={tasks} compact={workspaceMode} onAddTask={openModal} />
        <BoardFilterBar
          projectMembers={projectMembers}
          assigneeFilter={assigneeFilter}
          priorityFilter={priorityFilter}
          categoryFilter={categoryFilter}
          onToggleAssignee={(id) => toggleFilterValue("assignee", id)}
          onTogglePriority={(level) => toggleFilterValue("priority", level)}
          onToggleCategory={(id) => toggleFilterValue("category", id)}
          onReset={resetFilters}
          totalCount={tasks.length}
          filteredCount={filteredTasks.length}
        />

        <div className="flex-1 overflow-hidden min-h-0">
          {loadState === "loading" && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">업무를 불러오는 중...</div>
          )}
          {loadState === "error" && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span>업무를 불러오지 못했습니다.</span>
              <button
                onClick={loadTasks}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
                style={{ background: "var(--primary)" }}
              >
                <RefreshCw className="w-3.5 h-3.5" />다시 시도
              </button>
            </div>
          )}
          {loadState === "ready" && (
            workspaceMode && selTask ? (
              <PanelGroup direction="horizontal">
                <Panel defaultSize={workResultOpen ? 50 : 68} minSize={30} className="min-w-0">
                  <KanbanBoard
                    tasks={filteredTasks}
                    projectMembers={projectMembers}
                    compact
                    selectedId={selId}
                    onSelectTask={handleSelectTask}
                    onDropTask={handleDropTask}
                    onReorderTask={handleReorderTask}
                  />
                </Panel>
                <PanelResizeHandle className="group relative w-2.5 shrink-0 flex items-center justify-center outline-none cursor-col-resize">
                  <div className="w-1 h-10 rounded-full bg-border transition-colors group-hover:bg-blue-300 group-active:bg-blue-400" />
                </PanelResizeHandle>
                <Panel defaultSize={workResultOpen ? 25 : 32} minSize={24} maxSize={50} className="min-w-0">
                  <TaskDetailPanel
                    task={selTask}
                    projectMembers={projectMembers}
                    onClose={() => setSelId(null)}
                    onQuickAction={handleQuickAction}
                    onShowToast={showToast}
                    onDeleteTask={handleDeleteTask}
                    onEditTask={() => setEditingTask(selTask)}
                    onOpenWorkResult={() => setWorkResultOpen(true)}
                    onCancelCompletionRequest={() => handleCancelCompletionRequest(selTask.id)}
                  />
                </Panel>
                {workResultOpen && (
                  <>
                    <PanelResizeHandle className="group relative w-2.5 shrink-0 flex items-center justify-center outline-none cursor-col-resize">
                      <div className="w-1 h-10 rounded-full bg-border transition-colors group-hover:bg-blue-300 group-active:bg-blue-400" />
                    </PanelResizeHandle>
                    <Panel key={selTask.id} defaultSize={25} minSize={20} maxSize={45} className="min-w-0">
                      <TaskResultPanel
                        task={selTask}
                        onClose={() => setWorkResultOpen(false)}
                        onShowToast={showToast}
                      />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            ) : (
              <KanbanBoard
                tasks={filteredTasks}
                projectMembers={projectMembers}
                compact={false}
                selectedId={selId}
                onSelectTask={handleSelectTask}
                onDropTask={handleDropTask}
                onReorderTask={handleReorderTask}
              />
            )
          )}
        </div>

        <AddTaskModal open={showModal} initialStatus={modalStatus} projectMembers={projectMembers} onClose={() => setShowModal(false)} onCreated={handleTaskCreated} />
        <EditTaskModal task={editingTask} projectMembers={projectMembers} onClose={() => setEditingTask(null)} onUpdated={handleTaskUpdated} />

        {completionConfirmTaskId && (
          <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setCompletionConfirmTaskId(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <div className="text-sm font-bold text-foreground mb-1.5">업무를 완료했습니까?</div>
                <div className="text-xs text-muted-foreground mb-4">팀장에게 승인 요청하겠습니다.</div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setCompletionConfirmTaskId(null)}
                    className="px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={confirmCompletionRequest}
                    className="px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
                    style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
                  >
                    승인 신청
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DndProvider>
  );
}
