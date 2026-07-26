import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, AlertTriangle, Calendar, CheckCheck, Clock, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { useAiInsight } from "../../../ai/libs/hooks/useAiInsight";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { useAuth } from "../../../global/hooks/useAuth";
import { useInViewport } from "../../../global/hooks/useInViewport";
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
  isDangerDelayRisk,
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

function BlockerAiSuggestion({ task, projectId, ready }: { task: DashboardTaskDto; projectId: number | null | undefined; ready: boolean }) {
  // 블로커 카드가 몇 개든 화면에 스크롤해서 보여지는 카드만 RAG 질의를 보낸다 -
  // 뷰포트 밖 카드까지 한꺼번에 요청하면 업무 수만큼 LLM 호출이 낭비된다.
  const [cardRef, inView] = useInViewport<HTMLDivElement>();
  const prompt = `블로커 업무 '${task.title}'(설명: ${task.description || "등록된 설명 없음"})에 대해 먼저 처리할 일과, 해결 방법을 추천해줘. 출력은 3문장 이내로 해.`;
  const { text, loading, error } = useAiInsight(projectId, prompt, ready && inView);
  return (
    <div ref={cardRef} className="rounded-lg p-3 flex items-start gap-2.5 border" style={{ background: "rgba(112,72,232,0.05)", borderColor: "rgba(112,72,232,0.2)" }}>
      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#7048E8" }} />
      <p className="text-xs leading-relaxed" style={{ color: "#5B3DC8" }}>
        {!inView
          ? "화면에 표시되면 AI 해결 방법을 분석합니다..."
          : loading
            ? "AI가 해결 방법을 분석하고 있습니다..."
            : !error && text
              ? text
              : "AI 해결 방법을 불러오지 못했습니다."}
      </p>
    </div>
  );
}

export function BlockersPage() {
  const { user, currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: tasks, loading, error, refetch } = useDashboardTasks(currentProjectId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const [dueDateTarget, setDueDateTarget] = useState<DashboardTaskDto | null>(null);
  const [commentTarget, setCommentTarget] = useState<DashboardTaskDto | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [sortBy, setSortBy] = useState<BlockerSortBy>("duration");
  const { data: progress, loading: progressLoading } = useDashboardProgress(currentProjectId);
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

  const dangerRiskTaskIds = new Set((progress?.delayRisks ?? []).filter(risk => isDangerDelayRisk(risk.result)).map(risk => risk.taskId));
  const longestStalledDangerTask = tasks
    .filter(task => dangerRiskTaskIds.has(task.id))
    .reduce<{ title: string; days: number } | null>((longest, task) => {
      const days = daysSince(task.updatedAt) ?? 0;
      return !longest || days > longest.days ? { title: task.title, days } : longest;
    }, null);
  const aiInsightReady = !loading && !progressLoading;
  const aiInsightPrompt = longestStalledDangerTask
    ? `사용자의 지연 위험도 '위험' 업무 중, 가장 현재 상태 체류시간이 긴 업무인 '${longestStalledDangerTask.title}'에 대해 먼저 처리할 일과 다음 액션을 알려줘.`
    : "";
  const aiInsightFallback = longestStalledDangerTask
    ? `${user?.name ?? "담당자"}님의 ${longestStalledDangerTask.title}이 지연 위험입니다.`
    : "현재 지연 위험('위험') 업무가 없습니다.";

  const resolveBlocker = async (taskId: string, taskTitle: string) => {
    if (currentProjectId == null) return;
    if (!window.confirm(`'${taskTitle}' 블로커를 해결 완료로 처리할까요?`)) return;
    setActionError(null);
    setResolvingTaskId(taskId);
    try {
      await updateTaskPosition(taskId, "done", nextPositionForStatus(tasks, "done"), currentProjectId);
      alert("변경이 완료되었습니다.");
      refetch();
    } catch {
      setActionError("블로커 해결 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setResolvingTaskId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">블로커 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">막힌 업무를 파악하고 해결 담당자와 기한을 지정해 위험을 제거합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
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
        <DetailStatCard label="현재 블로커" value={loading ? "..." : blockedTasks.length} sub="해결 대기" color="#EF4444" icon={AlertTriangle} />
        <DetailStatCard label="심각도 높음" value={loading ? "..." : highPriorityCount} sub="즉시 조치 필요" color="#EF4444" icon={AlertCircle} />
        <DetailStatCard label="평균 지연" value={loading ? "..." : `${averageDelayDays}일`} sub={overdueRiskDelayDays.length === 0 ? "지연 대상 없음" : `주의·위험 ${overdueRiskDelayDays.length}건 기준`} color="#F59E0B" icon={Clock} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={aiInsightPrompt}
        ready={aiInsightReady && longestStalledDangerTask != null}
        fallbackText={aiInsightFallback}
        formatAnswer={answer => `${aiInsightFallback} ${answer}`}
      />

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
                    <div className="text-sm font-semibold text-foreground">{task.title}</div>
                  </div>
                </div>
                <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-100 text-red-700 shrink-0 whitespace-nowrap">
                  {statusDays}일째 지속
                </span>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">블로커 내용</div>
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

                <BlockerAiSuggestion task={task} projectId={currentProjectId} ready={aiInsightReady} />

                <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-border">
                  <button
                    onClick={() => resolveBlocker(task.id, task.title)}
                    disabled={resolvingTaskId === task.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> {resolvingTaskId === task.id ? "처리 중..." : "해결 완료"}
                  </button>
                  <button onClick={() => setDueDateTarget(task)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <Calendar className="w-3.5 h-3.5" /> 마감일 조정
                  </button>
                  <button onClick={() => setCommentTarget(task)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <MessageSquare className="w-3.5 h-3.5" /> 댓글
                  </button>
                  <button onClick={() => openAIAssistant(`블로커 업무 '${task.title}'의 해결 방법을 추천해줘. 현재 ${statusDays}일째 지속 중이고 담당자는 ${assignee.name}, 우선순위는 ${priority}야. 업무 설명: ${task.description || "등록된 설명 없음"}`)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ml-auto transition-opacity hover:opacity-80" style={{ background: "rgba(112,72,232,0.12)", color: "#7048E8" }}>
                    <Sparkles className="w-3.5 h-3.5" /> AI 해결 방법 추천
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {(loading || blockedTasks.length === 0) && (
          <div className="h-40 flex items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            {loading ? "데이터를 불러오는 중입니다" : "현재 블로커 업무가 없습니다."}
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
