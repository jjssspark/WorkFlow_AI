import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, AlertTriangle, Calendar, CheckCheck, Clock, Layers, MessageSquare, Plus, Sparkles } from "lucide-react";
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
  medium: { label: "중간", cls: "bg-amber-50 text-amber-600" },
  low: { label: "낮음", cls: "bg-slate-100 text-slate-500" },
};

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
  const { user, currentProjectId } = useAuth();
  const { data: tasks, loading, error, refetch } = useDashboardTasks(currentProjectId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const { data: progress, loading: progressLoading } = useDashboardProgress(currentProjectId);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const blockedTasks = tasks.filter(task => normalizeTaskStatus(task.status) === "blocked");
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
        <button onClick={() => navigate("/board?openAdd=1")} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
          <Plus className="w-3.5 h-3.5" /> 업무 추가
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>}

      <div className="grid grid-cols-4 gap-3">
        <DetailStatCard label="현재 블로커" value={loading ? "..." : blockedTasks.length} sub="해결 대기" color="#EF4444" icon={AlertTriangle} />
        <DetailStatCard label="심각도 높음" value={loading ? "..." : highPriorityCount} sub="즉시 조치 필요" color="#EF4444" icon={AlertCircle} />
        <DetailStatCard label="평균 지연" value={loading ? "..." : `${averageDelayDays}일`} sub={overdueRiskDelayDays.length === 0 ? "지연 대상 없음" : `주의·위험 ${overdueRiskDelayDays.length}건 기준`} color="#F59E0B" icon={Clock} iconBorder />
        <DetailStatCard label="AI 위험 감지" value={loading ? "..." : riskPredictions.length} sub="전체 업무 예측 결과" color="#7048E8" icon={Layers} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={aiInsightPrompt}
        ready={aiInsightReady && longestStalledDangerTask != null}
        fallbackText={aiInsightFallback}
        formatAnswer={answer => `${aiInsightFallback} ${answer}`}
      />

      <div className="space-y-4">
        {blockedTasks.map((task, index) => {
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
                  <button onClick={() => navigate("/board")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <Calendar className="w-3.5 h-3.5" /> 마감 조정
                  </button>
                  <button onClick={() => navigate("/board")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
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
    </div>
  );
}
