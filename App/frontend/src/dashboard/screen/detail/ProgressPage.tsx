import { useNavigate } from "react-router";
import { Calendar, CheckCircle2, CheckSquare, Sparkles, TrendingUp } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { BackBtn } from "../../../global/component/BackBtn";
import { CircleProgress } from "../../../global/component/CircleProgress";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardSummary } from "../../libs/hooks/useDashboardSummary";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import {
  daysSince,
  formatDDay,
  formatDashboardDueDate,
  isDangerDelayRisk,
  isDelayRisk,
  normalizeTaskStatus,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay } from "../../libs/utils/memberDisplay";

const CATEGORY_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"];

export function ProgressPage() {
  const { user, currentProjectId } = useAuth();
  const { data: summary, loading: summaryLoading, error: summaryError } = useDashboardSummary(currentProjectId);
  const { data: progress, loading, error: progressError } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoading } = useDashboardTasks(currentProjectId);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");

  const totalTasks = progress?.totalTasks ?? summary?.totalTasks ?? 0;
  const doneTasks = progress?.doneTasks ?? summary?.doneTasks ?? 0;
  const progressPercent = progress?.progressPercent ?? summary?.progressPercent ?? 0;
  const openTasks = Math.max(totalTasks - doneTasks, 0);
  const doneThisWeekRows = tasks
    .filter(task => normalizeTaskStatus(task.status) === "done" && (daysSince(task.updatedAt) ?? Infinity) <= 7)
    .slice(0, 5);
  const workload = summary?.workload ?? [];
  const categoryBreakdown = progress?.categoryBreakdown ?? [];
  const milestones = progress?.milestones ?? [];
  const projectDDay = formatDDay(progress?.projectDeadline);
  const error = summaryError ?? progressError;

  const dangerRiskTaskIds = new Set((progress?.delayRisks ?? []).filter(risk => isDangerDelayRisk(risk.result)).map(risk => risk.taskId));
  const longestStalledDangerTask = tasks
    .filter(task => dangerRiskTaskIds.has(task.id))
    .reduce<{ title: string; days: number } | null>((longest, task) => {
      const days = daysSince(task.updatedAt) ?? 0;
      return !longest || days > longest.days ? { title: task.title, days } : longest;
    }, null);
  const aiInsightReady = !summaryLoading && !loading && !tasksLoading;
  const aiInsightPrompt = longestStalledDangerTask
    ? `사용자의 지연 위험도 '위험' 업무 중, 가장 현재 상태 체류시간이 긴 업무인 '${longestStalledDangerTask.title}'에 대해 먼저 처리할 일과 다음 액션을 알려줘.`
    : "";
  const aiInsightFallback = longestStalledDangerTask
    ? `${user?.name ?? "담당자"}님의 ${longestStalledDangerTask.title}이 지연 위험입니다.`
    : "현재 지연 위험('위험') 업무가 없습니다.";
  const delayRiskCount = progress?.delayRisks.filter(risk => isDelayRisk(risk.result)).length ?? 0;
  const reportQuestion = `현재 프로젝트의 진행률 보고서를 생성해줘. 전체 업무 ${totalTasks}개 중 ${doneTasks}개가 완료되어 완료율은 ${progressPercent}%이고, 미완료 업무는 ${openTasks}개, 지연 주의·위험 업무는 ${delayRiskCount}개야. 핵심 현황과 일정 위험, 다음 액션을 요약해줘.`;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">진행률 분석</h1>
          <p className="text-sm text-muted-foreground mt-0.5">업무와 마일스톤 기준으로 완료 현황을 분석합니다.</p>
        </div>
        <button onClick={() => openAIAssistant(reportQuestion)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
          <Sparkles className="w-4 h-4" /> 진행률 보고서 생성
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-4 gap-3">
        <DetailStatCard label="전체 완료율" value={loading ? "..." : `${progressPercent}%`} sub={loading ? "불러오는 중" : `${doneTasks} / ${totalTasks} 완료`} color="#3B5BDB" icon={TrendingUp} />
        <DetailStatCard label="완료" value={loading ? "..." : `${doneTasks}개`} sub="완료 상태 업무" color="#10B981" icon={CheckCircle2} />
        <DetailStatCard label="목표 완료율" value="100%" sub={progress?.projectDeadline ? formatDashboardDueDate(progress.projectDeadline) : "마감일 미정"} color="#7048E8" icon={CheckSquare} />
        <DetailStatCard label="D-day" value={loading ? "..." : projectDDay} sub={formatDashboardDueDate(progress?.projectDeadline)} color="#F59E0B" icon={Calendar} iconBorder />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={aiInsightPrompt}
        ready={aiInsightReady && longestStalledDangerTask != null}
        fallbackText={aiInsightFallback}
        formatAnswer={answer => `${aiInsightFallback} ${answer}`}
      />

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <CircleProgress pct={loading ? 0 : progressPercent} size={156} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-3xl font-bold text-foreground">{loading ? "..." : `${progressPercent}%`}</div>
              <div className="text-[11px] text-muted-foreground">완료율</div>
            </div>
          </div>
          <div className="w-full border-t border-border pt-3 space-y-2">
            {[
              { label: "완료", count: doneTasks, color: "#10B981" },
              { label: "미완료", count: openTasks, color: "#C1C9D9" },
              { label: "블로커", count: summary?.blockedTasks ?? 0, color: "#EF4444" },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
                <span className="font-semibold text-foreground">{loading ? "..." : `${item.count}개`}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-card rounded-xl p-4 border border-border shadow-sm flex-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-foreground">AI 완료 예측</span>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground leading-relaxed">
              현재 완료율은 {progressPercent}%이며 지연 주의·위험 업무는 {delayRiskCount}개입니다. AI 보고서에서 일정 영향과 권장 조치를 함께 확인하세요.
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border shadow-sm">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">이번 주 완료된 업무</div>
            {doneThisWeekRows.map((task, index) => {
              const member = taskAssignee(task, index);
              return (
                <div key={task.id} className="flex items-center gap-2 py-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-xs text-foreground truncate flex-1">{task.title}</span>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: member.color }}>{member.initials}</div>
                </div>
              );
            })}
            {(tasksLoading || doneThisWeekRows.length === 0) && (
              <div className="text-xs text-muted-foreground py-2">
                {tasksLoading ? "데이터를 불러오는 중입니다" : "완료된 업무가 없습니다."}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl p-4 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">담당자별 완료 현황</div>
            <button onClick={() => navigate("/dashboard/workload")} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">업무량 보기</button>
          </div>
          <div className="space-y-4">
            {workload.map((entry, index) => {
              const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
              const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
              return (
                <div key={entry.assigneeId}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: member.color }}>{member.initials}</div>
                      <span className="font-medium text-foreground">{member.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono">{entry.done}/{entry.total}</span>
                      <span className={`font-semibold ${pct >= 60 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>{pct}%</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: member.color }} /></div>
                </div>
              );
            })}
            {(summaryLoading || workload.length === 0) && (
              <div className="text-xs text-muted-foreground">
                {summaryLoading ? "데이터를 불러오는 중입니다" : "담당자별 업무량 데이터가 없습니다."}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">업무 유형별 완료율</div>
            <button onClick={() => navigate("/dashboard/all-tasks")} className="text-[11px] font-medium text-blue-600">업무 보기</button>
          </div>
          <div className="divide-y divide-border">
            {categoryBreakdown.map((item, index) => {
              const pct = item.total === 0 ? 0 : Math.round((item.done / item.total) * 100);
              const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
              return (
                <div key={item.category} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="w-20 text-xs font-medium text-foreground shrink-0 truncate">{item.category}</div>
                  <div className="flex-1 h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
                  <span className="text-[10px] text-muted-foreground font-mono w-10 text-right">{item.done}/{item.total}</span>
                  <span className={`text-[10px] font-bold w-8 text-right ${pct === 100 ? "text-emerald-600" : pct === 0 ? "text-red-500" : "text-amber-600"}`}>{pct}%</span>
                </div>
              );
            })}
            {(loading || categoryBreakdown.length === 0) && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                {loading ? "데이터를 불러오는 중입니다" : "카테고리 데이터가 없습니다."}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">마일스톤 진행 현황</div>
            <button onClick={() => navigate("/dashboard/dash-progress")} className="text-[11px] font-medium text-blue-600">상세 보기</button>
          </div>
          <div className="divide-y divide-border">
            {milestones.slice(0, 6).map((item, index) => {
              const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
              return (
                <div key={item.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="w-28 text-xs font-medium text-foreground shrink-0 truncate">{item.title}</div>
                  <div className="flex-1 h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${item.progressPercent}%`, background: color }} /></div>
                  <span className="text-[10px] text-muted-foreground w-14 text-right">{formatDashboardDueDate(item.dueDate)}</span>
                  <span className="text-[10px] font-bold w-8 text-right text-foreground">{item.progressPercent}%</span>
                </div>
              );
            })}
            {(loading || milestones.length === 0) && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                {loading ? "데이터를 불러오는 중입니다" : "마일스톤 데이터가 없습니다."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
