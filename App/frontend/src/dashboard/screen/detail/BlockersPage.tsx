import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, AlertTriangle, Calendar, CheckCheck, Clock, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { updateTaskPosition } from "../../../board/libs/utils/taskApi";
import { TaskDueDatePopup } from "../../components/TaskDueDatePopup";
import { TaskDetailPopup } from "../../components/TaskDetailPopup";
import { AddTaskModal } from "../../../board/components/AddTaskModal";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";
import type { DashboardTaskDto } from "../../libs/types/dashboard";
import type { Priority } from "../../../board/libs/types/task";
import {
  daysSince,
  daysUntilDue,
  formatDashboardDueDate,
  isDelayRisk,
  nextPositionForStatus,
  normalizePriority,
  normalizeTaskStatus,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";

const BLOCKER_PRIORITY_LABEL: Record<Priority, { label: string; cls: string }> = {
  high: { label: "심각도 높음", cls: "bg-red-50 text-red-600" },
  medium: { label: "심각도 중간", cls: "bg-amber-50 text-amber-600" },
  low: { label: "심각도 낮음", cls: "bg-slate-100 text-slate-500" },
};
const PRIORITY_SORT_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const RISK_SORT_ORDER: Record<string, number> = { 위험: 0, 주의: 1, 정상: 2 };
type BlockerSortBy = "duration" | "id" | "priority" | "risk" | "dueDate" | "assignee" | "category";

export function BlockersPage() {
  const { currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: tasks, loading: tasksLoadingRaw, error, refetch } = useDashboardTasks(currentProjectId);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  // useDashboardTasks의 loading은 최초 로드 이후 refetch에서는 true로 안 바뀌므로,
  // 새로고침 버튼을 눌렀을 때 스피너/문구가 뜨려면 별도의 pageRefreshing으로 합쳐서 써야 한다.
  const loading = tasksLoadingRaw || pageRefreshing;
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const [dueDateTarget, setDueDateTarget] = useState<DashboardTaskDto | null>(null);
  const [commentTarget, setCommentTarget] = useState<DashboardTaskDto | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [sortBy, setSortBy] = useState<BlockerSortBy>("duration");
  const { data: progress } = useDashboardProgress(currentProjectId);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");

  useEffect(() => {
    if (currentProjectId == null) {
      setProjectMembers([]);
      return;
    }
    let cancelled = false;
    getProjectMembers(currentProjectId)
      .then(result => { if (!cancelled) setProjectMembers(result); })
      .catch(() => { if (!cancelled) setProjectMembers([]); });
    return () => { cancelled = true; };
  }, [currentProjectId]);
  const delayRiskByTaskId = new Map((progress?.delayRisks ?? []).map(risk => [risk.taskId, risk.result]));
  const blockedTasks = tasks
    .filter(task => normalizeTaskStatus(task.status) === "blocked")
    .sort((a, b) => {
      if (sortBy === "duration") return (daysSince(b.updatedAt) ?? 0) - (daysSince(a.updatedAt) ?? 0);
      if (sortBy === "id") return (Number(a.id) || 0) - (Number(b.id) || 0);
      if (sortBy === "priority") return PRIORITY_SORT_ORDER[normalizePriority(a.priority)] - PRIORITY_SORT_ORDER[normalizePriority(b.priority)];
      if (sortBy === "risk") return (RISK_SORT_ORDER[delayRiskByTaskId.get(a.id) ?? ""] ?? 3) - (RISK_SORT_ORDER[delayRiskByTaskId.get(b.id) ?? ""] ?? 3);
      if (sortBy === "dueDate") return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
      if (sortBy === "assignee") return (a.assigneeName ?? "").localeCompare(b.assigneeName ?? "");
      if (sortBy === "category") return (a.category ?? "").localeCompare(b.category ?? "");
      return 0;
    });
  const highPriorityCount = blockedTasks.filter(task => normalizePriority(task.priority) === "high").length;
  const riskPredictions = progress?.delayRisks.filter(risk => isDelayRisk(risk.result)) ?? [];
  const riskTaskIds = new Set(riskPredictions.map(risk => risk.taskId));
  const overdueRiskDelayDays = riskPredictions
    .map(risk => daysUntilDue(risk.dueDate))
    .filter((days): days is number => days != null && days < 0)
    .map(days => -days);
  const averageDelayDays = overdueRiskDelayDays.length === 0
    ? 0
    : Math.round(overdueRiskDelayDays.reduce((sum, days) => sum + days, 0) / overdueRiskDelayDays.length);

  const resolveBlocker = async (taskId: string, taskTitle: string) => {
    if (currentProjectId == null) return;
    if (!window.confirm(`'${taskTitle}' 검토를 완료로 처리할까요?`)) return;
    setActionError(null);
    setResolvingTaskId(taskId);
    try {
      await updateTaskPosition(taskId, "done", nextPositionForStatus(tasks, "done"), currentProjectId);
      alert("변경이 완료되었습니다.");
      refetch();
    } catch {
      setActionError("검토 완료 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setResolvingTaskId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">검토 필요 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">막힌 업무를 파악하고 해결 담당자와 기한을 지정해 위험을 제거합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { setPageRefreshing(true); try { await refetch(); } finally { setPageRefreshing(false); } }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "새로고침 중..." : "새로고침"}
          </button>
          {isLeader && (
            <button onClick={() => setShowAddTask(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
              <Plus className="w-3.5 h-3.5" /> 업무 추가
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>}

      <div className="grid grid-cols-3 gap-3">
        <DetailStatCard label="현재 검토 필요" value={loading ? "..." : blockedTasks.length} sub="해결 대기" color="var(--status-blocked)" icon={AlertTriangle} />
        <DetailStatCard label="심각도 높음" value={loading ? "..." : highPriorityCount} sub="즉시 조치 필요" color="var(--status-blocked)" icon={AlertCircle} />
        <DetailStatCard label="평균 지연" value={loading ? "..." : `${averageDelayDays}일`} sub={overdueRiskDelayDays.length === 0 ? "지연 대상 없음" : `주의·위험 ${overdueRiskDelayDays.length}건 기준`} color="var(--status-due)" icon={Clock} />
      </div>

      <div className="flex items-center justify-end">
        <select value={sortBy} onChange={e => setSortBy(e.target.value as BlockerSortBy)} className="text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground outline-none cursor-pointer">
          <option value="duration">지속시간순</option>
          <option value="id">ID순</option>
          <option value="priority">심각도순</option>
          <option value="risk">지연 위험도순</option>
          <option value="dueDate">마감일순</option>
          <option value="assignee">담당자순</option>
          <option value="category">카테고리순</option>
        </select>
      </div>

      <div className="space-y-4">
        {!loading && blockedTasks.map((task, index) => {
          const assignee = taskAssignee(task, index);
          const priority = normalizePriority(task.priority);
          const priorityTag = BLOCKER_PRIORITY_LABEL[priority];
          const statusDays = daysSince(task.updatedAt) ?? 0;
          const isRisk = riskTaskIds.has(task.id);
          return (
            <div key={task.id} className="bg-card rounded-xl border-2 border-red-200 shadow-sm overflow-hidden">
              <div className="flex items-start justify-between px-5 py-3.5 border-b border-red-100 bg-red-50/50">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <div className="flex items-center flex-wrap gap-1.5 mb-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${priorityTag.cls}`}>{priorityTag.label}</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{task.category ?? "미분류"}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{task.id}</span>
                      {isRisk && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">지연 위험</span>}
                    </div>
                    <div onClick={() => setCommentTarget(task)} className="text-sm font-semibold text-foreground cursor-pointer hover:text-blue-700">{task.title}</div>
                  </div>
                </div>
                <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-100 text-red-700 shrink-0 whitespace-nowrap">
                  {statusDays}일째 지속
                </span>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">검토 필요 사유</div>
                  <p className="text-sm text-foreground leading-relaxed">{task.description || "등록된 설명이 없습니다. 업무 보드에서 상세 내용을 추가하세요."}</p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5">담당자</div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: assignee.color }}>{assignee.initials}</div>
                      <span className="text-xs font-medium text-foreground">{assignee.name}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5">발생일</div>
                    <span className="text-xs text-foreground">{formatDashboardDueDate(task.createdAt)}</span>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1.5">마감일</div>
                    <span className="text-xs text-foreground">{formatDashboardDueDate(task.dueDate)}</span>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-border">
                  <button
                    onClick={() => resolveBlocker(task.id, task.title)}
                    disabled={resolvingTaskId === task.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> {resolvingTaskId === task.id ? "처리 중..." : "해결 완료"}
                  </button>
                  {isLeader && (
                    <button onClick={() => setDueDateTarget(task)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                      <Calendar className="w-3.5 h-3.5" /> 마감일 조정
                    </button>
                  )}
                  <button onClick={() => setCommentTarget(task)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <MessageSquare className="w-3.5 h-3.5" /> 댓글
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {(loading || blockedTasks.length === 0) && (
          <div className="h-40 flex items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            {loading ? "데이터를 불러오는 중입니다" : "현재 검토 필요 업무가 없습니다."}
          </div>
        )}
      </div>

      {dueDateTarget && currentProjectId != null && (
        <TaskDueDatePopup
          task={dueDateTarget}
          projectId={currentProjectId}
          onClose={() => setDueDateTarget(null)}
          onChanged={() => { setDueDateTarget(null); refetch(); }}
        />
      )}
      {commentTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={commentTarget}
          projectId={currentProjectId}
          focusComments
          onClose={() => setCommentTarget(null)}
          isLeader={isLeader}
          projectMembers={projectMembers}
          onUpdated={() => refetch()}
        />
      )}
      <AddTaskModal
        open={showAddTask}
        initialStatus="blocked"
        projectMembers={projectMembers}
        onClose={() => { setShowAddTask(false); refetch(); }}
        onCreated={() => refetch()}
      />
    </div>
  );
}
