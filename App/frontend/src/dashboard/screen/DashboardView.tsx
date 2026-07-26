import { useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Clock,
  Columns3,
  Layers,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { Avatar } from "../../global/component/Avatar";
import { StatCard } from "../../global/component/StatCard";
import { StatusIcon } from "../../global/component/StatusIcon";
import { NAV_ITEMS } from "../../global/lib/constants/nav";
import { useAuth } from "../../global/hooks/useAuth";
import type { DetailPage } from "../../board/libs/types/task";
import { useDashboardProgress } from "../libs/hooks/useDashboardProgress";
import { useDashboardSummary } from "../libs/hooks/useDashboardSummary";
import { useDashboardTasks } from "../libs/hooks/useDashboardTasks";
import { activityIconMeta, activityMessage, activityTypeLabel, formatRelativeTime } from "../libs/utils/activityDisplay";
import { daysSince, daysUntilDue, formatDashboardDueDate, isDangerDelayRisk, normalizeTaskStatus } from "../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay } from "../libs/utils/memberDisplay";
import { AiInsightBox } from "../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../ai/libs/utils/openAIAssistant";
import { ProgressFrequencyChart } from "../components/ProgressFrequencyChart";

function EmptyState({ children }: { children: string }) {
  return <div className="w-full h-full flex items-center justify-center py-8 text-center text-xs text-muted-foreground">{children}</div>;
}

/** '팀원별 업무량' 막대 그래프 툴팁 — 막대 색은 연한 회색을 유지하되, '전체' 항목의 텍스트만 진한 회색으로 강조한다. */
function WorkloadTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white shadow-lg border border-border px-3 py-2 text-[11px] space-y-1">
      <div className="font-semibold text-foreground">{label}</div>
      {payload.map(entry => {
        const color = entry.dataKey === "전체" ? "#6B7280" : entry.color;
        return (
          <div key={entry.dataKey} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span style={{ color }}>{entry.dataKey} : {entry.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardView() {
  const navigate = useNavigate();
  const onCardClick = (p: DetailPage) => navigate(`/dashboard/${p}`);
  const { user, currentProjectId } = useAuth();
  const { data: summary, loading: summaryLoading, error: summaryError } = useDashboardSummary(currentProjectId);
  const { data: progress, loading: progressLoading, error: progressError } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoading } = useDashboardTasks(currentProjectId);

  const deliverablesActive = NAV_ITEMS.find((item) => item.id === "deliverables")?.activate !== false;
  const isSummaryPending = summaryLoading && !summary;
  const isProgressPending = progressLoading && !progress;
  const totalTasks = summary?.totalTasks ?? 0;
  const doneTasks = summary?.doneTasks ?? 0;
  const progressPct = summary?.progressPercent ?? 0;
  const blockedTasks = summary?.blockedTasks ?? 0;
  const inProgressTasks = summary?.inProgressTasks ?? 0;
  const workload = summary?.workload ?? [];
  const upcomingDeadlines = summary?.upcomingDeadlines ?? [];
  const recentActivity = summary?.recentActivity ?? [];
  const memberWorkloadChart = workload.map((entry, index) => ({
    name: resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId).name,
    전체: entry.total,
    완료: entry.done,
  }));

  const projectStart = progress?.projectCreatedAt ?? null;
  const projectDeadline = progress?.projectDeadline ?? null;

  const dangerRiskTaskIds = new Set((progress?.delayRisks ?? []).filter(risk => isDangerDelayRisk(risk.result)).map(risk => risk.taskId));
  const longestStalledDangerTask = tasks
    .filter(task => dangerRiskTaskIds.has(task.id))
    .reduce<{ title: string; days: number } | null>((longest, task) => {
      const days = daysSince(task.updatedAt) ?? 0;
      return !longest || days > longest.days ? { title: task.title, days } : longest;
    }, null);
  const aiInsightReady = !summaryLoading && !progressLoading && !tasksLoading;
  const aiInsightPrompt = longestStalledDangerTask
    ? `사용자의 지연 위험도 '위험' 업무 중, 가장 현재 상태 체류시간이 긴 업무인 '${longestStalledDangerTask.title}'에 대해 먼저 처리할 일과 다음 액션을 알려줘.`
    : "";

  const quickActions = [
    { label: "업무 추가", icon: Plus, color: "#3B5BDB", onClick: () => navigate("/board?openAdd=1") },
    { label: "회의록 업로드", icon: Upload, color: "#7048E8", onClick: () => navigate("/meetings?upload=1") },
    ...(deliverablesActive ? [{ label: "산출물", icon: Package, color: "#0F766E", onClick: () => navigate("/deliverables") }] : []),
    { label: "AI 어시스턴트", icon: Sparkles, color: "#F59E0B", onClick: () => openAIAssistant() },
    { label: "업무 보드", icon: Columns3, color: "#0EA5E9", onClick: () => navigate("/board") },
    // { label: "전체 업무", icon: Users, color: "#EC4899", onClick: () => navigate("/dashboard/all-tasks") },
    // { label: "마감 임박", icon: Clock, color: "#EF4444", onClick: () => navigate("/dashboard/urgent") },
  ];

  if (currentProjectId == null) {
    return (
      <div className="h-full p-6 flex items-center justify-center text-sm text-muted-foreground">
        프로젝트를 선택하면 Supabase에 저장된 대시보드 데이터가 표시됩니다.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full relative" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      {(summaryError || progressError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          데이터를 불러오지 못했습니다. {summaryError ?? progressError}
        </div>
      )}

      {longestStalledDangerTask ? (
        <AiInsightBox
          projectId={currentProjectId}
          prompt={aiInsightPrompt}
          ready={aiInsightReady}
          fallbackText={`${user?.name ?? "담당자"}님의 ${longestStalledDangerTask.title}이 지연 위험입니다.`}
          formatAnswer={answer => `${user?.name ?? "담당자"}님의 ${longestStalledDangerTask.title}이 지연 위험입니다. ${answer}`}
          actionLabel="자세히"
          variant="banner"
        />
      ) : (
        <div className="rounded-xl p-4 flex items-center gap-3 text-white" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">AI 추천 액션</div>
            <div className="text-xs text-white/85 mt-0.5">
              {aiInsightReady ? "현재 지연 위험('위험') 업무가 없습니다." : "데이터를 불러오는 중입니다..."}
            </div>
          </div>
          <button onClick={() => openAIAssistant()} className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 bg-white/20 hover:bg-white/30 transition-colors">
            자세히
          </button>
        </div>
      )}

      <div className="bg-card rounded-xl p-4 shadow-sm border border-border">
        <div className="text-sm font-semibold text-foreground mb-3">빠른 액션</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {quickActions.map(action => {
            const Icon = action.icon;
            return (
              <button key={action.label} onClick={action.onClick} className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card hover:shadow-sm hover:border-slate-300 transition-all text-left">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${action.color}18` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: action.color }} />
                </div>
                <span className="text-xs font-medium text-foreground leading-tight">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="전체 업무" value={isSummaryPending ? "..." : totalTasks} sub={isSummaryPending ? "불러오는 중" : `완료 ${doneTasks}개`} color="#3B5BDB" onClick={() => onCardClick("all-tasks")} />
        <StatCard icon={TrendingUp} label="완료율" value={isSummaryPending ? "..." : `${progressPct}%`} sub={isSummaryPending ? "불러오는 중" : "실제 업무 기준"} color="#10B981" onClick={() => onCardClick("progress")} />
        <StatCard icon={AlertTriangle} label="블로커" value={isSummaryPending ? "..." : blockedTasks} sub={isSummaryPending ? "불러오는 중" : "즉시 해결 필요"} color="#EF4444" onClick={() => onCardClick("blockers")} />
        <StatCard icon={Clock} label="진행 중" value={isSummaryPending ? "..." : inProgressTasks} sub={isSummaryPending ? "불러오는 중" : "활성 업무"} color="#F59E0B" onClick={() => onCardClick("inprogress")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div onClick={() => onCardClick("dash-progress")} className="lg:col-span-2 bg-card rounded-xl p-5 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-foreground">전체 진행률</div>
              <div className="text-xs text-muted-foreground mt-0.5">실제 업무 완료 기준</div>
            </div>
            <div className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{summaryLoading ? "..." : progressPct}%</div>
          </div>
          <div className="w-full bg-muted rounded-full h-2 mb-4">
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%`, background: "linear-gradient(90deg, #3B5BDB, #7048E8)" }} />
          </div>
          <div className="h-40" onClick={e => e.stopPropagation()}>
            <ProgressFrequencyChart
              tasks={tasks}
              projectStart={projectStart}
              projectDeadline={projectDeadline}
              totalTasks={totalTasks}
              loading={isProgressPending}
            />
          </div>
        </div>

        <div onClick={() => onCardClick("urgent")} className="bg-card rounded-xl p-5 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">마감 임박 업무</div>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {isSummaryPending ? (
              <EmptyState>데이터를 불러오는 중입니다</EmptyState>
            ) : upcomingDeadlines.length ? upcomingDeadlines.map((task, index) => {
              const member = resolveMemberDisplay(task.assigneeName, index);
              const dueSoon = (daysUntilDue(task.dueDate) ?? Infinity) <= 3;
              return (
                <div key={task.id} className="flex items-center gap-2.5">
                  {dueSoon ? (
                    <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <StatusIcon status={normalizeTaskStatus(task.status)} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{task.title}</div>
                    <div className="text-[10px] text-muted-foreground">마감 {formatDashboardDueDate(task.dueDate)}</div>
                  </div>
                  <Avatar member={member} size="sm" />
                </div>
              );
            }) : <EmptyState>마감 예정 업무가 없습니다.</EmptyState>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div onClick={() => onCardClick("workload")} className="bg-card rounded-xl p-5 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">팀원별 업무량</div>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {isSummaryPending ? (
              <EmptyState>데이터를 불러오는 중입니다</EmptyState>
            ) : workload.length ? workload.map((entry, index) => {
              const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
              const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
              return (
                <div key={entry.assigneeId}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-foreground">{member.name}</span>
                    <span className="text-muted-foreground">{entry.done}/{entry.total}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: member.color }} />
                  </div>
                </div>
              );
            }) : <EmptyState>팀원별 업무 데이터가 없습니다.</EmptyState>}
          </div>
          {memberWorkloadChart.length > 0 && (
            <div className="h-32 mt-4 pt-3 border-t border-border">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memberWorkloadChart} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#8892A4" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#8892A4" }} allowDecimals={false} />
                  <Tooltip content={<WorkloadTooltip />} />
                  <Bar dataKey="전체" fill="#C1C9D9" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="완료" fill="#3B5BDB" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div onClick={() => onCardClick("activity")} className="bg-card rounded-xl p-5 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">최근 활동</div>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {isSummaryPending ? (
              <EmptyState>데이터를 불러오는 중입니다</EmptyState>
            ) : recentActivity.length ? recentActivity.slice(0, 5).map(entry => {
              const meta = activityIconMeta(entry.type);
              const ActivityIcon = meta.icon;
              return (
              <div key={entry.id} className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: meta.bg }}>
                  <ActivityIcon className="w-3 h-3" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground font-medium truncate">{activityMessage(entry)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {activityTypeLabel(entry.type)} · {entry.actorName ?? "알 수 없음"} · {formatRelativeTime(entry.createdAt)}
                  </div>
                </div>
              </div>
              );
            }) : <EmptyState>최근 활동이 없습니다.</EmptyState>}
          </div>
        </div>
      </div>
    </div>
  );
}
