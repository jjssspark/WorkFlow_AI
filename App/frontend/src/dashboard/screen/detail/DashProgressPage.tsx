import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Calendar, Clock, FileText, Plus, Sparkles, Target } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import type { TaskStatus } from "../../../board/libs/types/task";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { MilestoneAddPopup } from "../../components/MilestoneAddPopup";
import {
  ProgressFrequencyChart,
  buildYTicks,
  dateKeyOf,
  CHART_MARGIN_BOTTOM,
  CHART_MARGIN_TOP,
  FREQUENCY_POINT_WIDTH,
  FREQUENCY_WINDOW_DAYS,
  Y_TICK_SEGMENTS,
} from "../../components/ProgressFrequencyChart";
import {
  expectedProgressPercent,
  formatDashboardDueDate,
  formatDDay,
  isDelayRisk,
  normalizeTaskStatus,
} from "../../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay } from "../../libs/utils/memberDisplay";
import type { DashboardTaskDto } from "../../libs/types/dashboard";

const MILESTONE_STATUS_MAP: Record<TaskStatus, { cls: string; label: string }> = {
  done: { cls: "bg-emerald-100 text-emerald-700", label: "완료" },
  inprogress: { cls: "bg-blue-100 text-blue-700", label: "진행 중" },
  todo: { cls: "bg-slate-100 text-slate-500", label: "예정" },
  blocked: { cls: "bg-red-100 text-red-700", label: "지연" },
};

const STATUS_LEGEND = [
  { label: "완료·양호", color: "#10B981" },
  { label: "진행 중", color: "#3B5BDB" },
  { label: "지연 위험", color: "#F59E0B" },
  { label: "미시작", color: "#C1C9D9" },
];

/** 카테고리 상태 4단계 분류 기준.
 * 1) 카테고리에 업무가 하나도 없으면 미시작(회색).
 * 2-1) (1이 아니고) status='done'인 업무 비율이 100% → 완료·양호(초록)
 * 2-2) (1이 아니고) ML 지연위험도 예측이 '주의' 또는 '위험'인 업무 비율이 50% 이상 → 지연 위험(주황)
 * 3) 그 외 → 진행 중(파랑). 
 */
function categoryStatusColor(params: { total: number; done: number; riskRatio: number }): string {
  // 1) 미시작
  if (params.total === 0) return "#C1C9D9"; 
  
  // 2-1) 전체 완료 (우선순위 상향)
  if (params.done === params.total) return "#10B981"; 
  
  // 2-2) 지연 위험
  if (params.riskRatio >= 0.5) return "#F59E0B"; 
  
  // 3) 진행 중
  return "#3B5BDB"; 
}

function normalizeMilestoneStatus(status: string): TaskStatus {
  const normalized = status.toLowerCase() as TaskStatus;
  return normalized in MILESTONE_STATUS_MAP ? normalized : "todo";
}

interface DailyCompletionPoint {
  dateKey: string;
  label: string;
  [memberKey: string]: string | number;
}

interface DailyCompletionMember {
  key: string;
  name: string;
  color: string;
}

/** '날짜별 완료 업무량' 막대그래프 데이터 — 완료된 날짜별로 담당자 완료 건수를 스택으로 합산한다.
 * '계획 대비 실제 진행률' 선 그래프와 동일하게 오늘 완료가 없어도 '오늘'을 마지막 포인트로 포함시킨다. */
function buildDailyCompletionChart(
  tasks: DashboardTaskDto[],
  projectStart: string | null,
  projectDeadline: string | null
): { points: DailyCompletionPoint[]; members: DailyCompletionMember[] } {
  if (!projectStart) return { points: [], members: [] };
  const rangeStart = dateKeyOf(projectStart);
  const rangeEnd = projectDeadline ? dateKeyOf(projectDeadline) : dateKeyOf(new Date().toISOString());
  const todayKey = dateKeyOf(new Date().toISOString());

  const doneTasks = tasks.filter(task => normalizeTaskStatus(task.status) === "done" && task.updatedAt);

  const memberMap = new Map<string, DailyCompletionMember>();
  doneTasks.forEach(task => {
    const key = task.assigneeId ?? task.assigneeName ?? "unassigned";
    if (!memberMap.has(key)) {
      const display = resolveMemberDisplay(task.assigneeName, memberMap.size, task.assigneeId);
      memberMap.set(key, { key, name: display.name, color: display.color });
    }
  });
  const members = Array.from(memberMap.values());

  const changeDates = new Set<string>();
  doneTasks.forEach(task => changeDates.add(dateKeyOf(task.updatedAt as string)));
  if (todayKey >= rangeStart && todayKey <= rangeEnd) changeDates.add(todayKey);
  const sortedDates = Array.from(changeDates).filter(dateKey => dateKey >= rangeStart && dateKey <= rangeEnd).sort();

  const points = sortedDates.map(dateKey => {
    const point: DailyCompletionPoint = { dateKey, label: dateKey === todayKey ? "오늘" : formatDashboardDueDate(dateKey) };
    members.forEach(member => { point[member.key] = 0; });
    doneTasks.forEach(task => {
      if (dateKeyOf(task.updatedAt as string) === dateKey) {
        const key = task.assigneeId ?? task.assigneeName ?? "unassigned";
        point[key] = (point[key] as number) + 1;
      }
    });
    return point;
  });

  return { points, members };
}

function DailyCompletionTooltip({
  active,
  payload,
  label,
  members,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
  members: DailyCompletionMember[];
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter(entry => (entry.value ?? 0) > 0);
  const total = entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  return (
    <div className="rounded-lg bg-white shadow-lg border border-border px-3 py-2 text-[11px] space-y-1">
      <div className="font-semibold text-foreground">{label} · 총 {total}개</div>
      {entries.map(entry => {
        const member = members.find(m => m.key === entry.dataKey);
        return (
          <div key={entry.dataKey} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: member?.color }} />
            <span className="text-muted-foreground">{member?.name}</span>
            <span className="font-medium text-foreground">{entry.value}개</span>
          </div>
        );
      })}
      {entries.length === 0 && <div className="text-muted-foreground">완료된 업무가 없습니다.</div>}
    </div>
  );
}

export function DashProgressPage() {
  const { user, currentProjectId } = useAuth();
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const onGoUrgent = () => navigate("/dashboard/urgent");
  const { data: progress, loading, error, refetch } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoading } = useDashboardTasks(currentProjectId);
  const [showMilestonePopup, setShowMilestonePopup] = useState(false);

  const totalTasks = progress?.totalTasks ?? 0;
  const doneTasks = progress?.doneTasks ?? 0;
  const progressPercent = progress?.progressPercent ?? 0;
  const delayRisks = progress?.delayRisks.filter(risk => isDelayRisk(risk.result)) ?? [];
  const delayRiskTaskIds = new Set(delayRisks.map(risk => risk.taskId));
  const categories = progress?.categoryBreakdown ?? [];
  const tasksByCategory = new Map<string, DashboardTaskDto[]>();
  tasks.forEach(task => {
    const key = task.category ?? "";
    const list = tasksByCategory.get(key);
    if (list) list.push(task);
    else tasksByCategory.set(key, [task]);
  });
  const milestones = progress?.milestones ?? [];
  const projectCreatedAt = progress?.projectCreatedAt ?? null;
  const projectDeadline = progress?.projectDeadline ?? null;
  const expectedProgress = expectedProgressPercent(projectCreatedAt, projectDeadline);
  const projectDDay = formatDDay(projectDeadline);
  const insightPrompt = `현재 프로젝트의 진행 상황을 분석해줘. 실제 완료율은 ${progressPercent}%, 계획상 예상 진행률은 ${expectedProgress ?? "미정"}%, 지연 주의·위험 업무는 ${delayRisks.length}개, 프로젝트 마감은 ${projectDDay}야. 계획 대비 차이와 주요 위험, 권장 조치를 정리해줘. 출력은 3문장 이내로 해.`;
  const insightFallback = "계획 대비 진행률과 지연 예측을 바탕으로 다음 액션을 추천받을 수 있습니다.";

  const { points: dailyCompletionPoints, members: dailyCompletionMembers } = buildDailyCompletionChart(
    tasks,
    projectCreatedAt,
    projectDeadline
  );
  // 실제 데이터 포인트 수가 7개 미만이면 빈 스크롤 여백 없이 카드 폭 전체를 채운다 (ProgressFrequencyChart와 동일한 기준).
  const chartsFillFullWidth = dailyCompletionPoints.length < FREQUENCY_WINDOW_DAYS;
  const dailyCompletionYMax = Math.max(
    ...dailyCompletionPoints.map(point => dailyCompletionMembers.reduce((sum, member) => sum + (point[member.key] as number), 0)),
    1
  );
  const dailyCompletionScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dailyCompletionScrollRef.current?.scrollTo({ left: dailyCompletionScrollRef.current.scrollWidth });
  }, [dailyCompletionPoints.length]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">전체 진행률</h1>
          <p className="text-sm text-muted-foreground mt-0.5">프로젝트 일정 대비 진행 현황을 분석하고 지연 위험을 파악합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onGoUrgent} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-red-200 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"><AlertTriangle className="w-3.5 h-3.5" />마감 업무</button>
          <button onClick={() => openAIAssistant(insightPrompt)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><FileText className="w-3.5 h-3.5" />진행률 보고서</button>
          <button onClick={() => openAIAssistant(insightPrompt)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
            <Sparkles className="w-3.5 h-3.5" />AI 요약 요청
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3">
        <DetailStatCard label="전체 완료율" value={loading ? "..." : `${progressPercent}%`} sub={loading ? "불러오는 중" : `${doneTasks} / ${totalTasks} 완료`} color="#3B5BDB" icon={Target} />
        <DetailStatCard label="지연 업무" value={loading ? "..." : `${delayRisks.length}개`} sub="즉시 검토 필요" color="#EF4444" icon={Clock} />
        <DetailStatCard label="마감 D-day" value={loading ? "..." : projectDDay} sub={formatDashboardDueDate(projectDeadline)} color="#F59E0B" icon={Calendar} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={insightPrompt}
        ready={!loading}
        fallbackText={insightFallback}
      />

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-foreground">계획 대비 실제 진행률</div>
            </div>
            <div className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{loading ? "..." : progressPercent}%</div>
          </div>
          <div className="text-right text-[10px] text-muted-foreground mb-1">기준: 주별 완료 업무 수</div>
          <div className="h-40">
            <ProgressFrequencyChart
              tasks={tasks}
              projectStart={projectCreatedAt}
              projectDeadline={projectDeadline}
              totalTasks={totalTasks}
              loading={loading || tasksLoading}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-foreground">날짜별 완료 업무량</div>
              {dailyCompletionMembers.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {dailyCompletionMembers.map(member => (
                    <div key={member.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: member.color }} />
                      <span>{member.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="h-40 flex">
              {loading || tasksLoading ? (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">데이터를 불러오는 중입니다</div>
              ) : dailyCompletionPoints.length ? (
                <>
                  <div className="w-10 shrink-0 relative">
                    <span className="absolute top-0 left-0.5 text-[9px] leading-none text-muted-foreground">(개)</span>
                    <div
                      className="absolute left-0 right-1 flex flex-col justify-between text-right text-[10px] text-muted-foreground"
                      style={{ top: CHART_MARGIN_TOP, bottom: CHART_MARGIN_BOTTOM }}
                    >
                      {buildYTicks(dailyCompletionYMax, Y_TICK_SEGMENTS).map(tick => <span key={tick}>{tick}</span>)}
                    </div>
                  </div>
                  <div
                    ref={dailyCompletionScrollRef}
                    className={chartsFillFullWidth ? "flex-1 h-full relative overflow-hidden" : "flex-1 h-full overflow-x-auto overflow-y-hidden cursor-grab relative"}
                  >
                    <span className="absolute bottom-1 right-1 text-[9px] leading-none text-muted-foreground">(일)</span>
                    <div
                      style={{
                        width: chartsFillFullWidth
                          ? "100%"
                          : Math.max(dailyCompletionPoints.length * FREQUENCY_POINT_WIDTH, FREQUENCY_WINDOW_DAYS * FREQUENCY_POINT_WIDTH),
                        height: "100%",
                      }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyCompletionPoints} margin={{ top: CHART_MARGIN_TOP, right: 8, left: 0, bottom: CHART_MARGIN_BOTTOM }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: "#8892A4" }}
                            axisLine={{ stroke: "#94A3B8" }}
                            tickLine={false}
                          />
                          <YAxis domain={[0, dailyCompletionYMax]} hide />
                          <Tooltip content={<DailyCompletionTooltip members={dailyCompletionMembers} />} />
                          {dailyCompletionMembers.map(member => (
                            <Bar key={member.key} dataKey={member.key} name={member.name} stackId="daily" fill={member.color} radius={[2, 2, 0, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">표시할 완료 업무 데이터가 없습니다.</div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="text-sm font-semibold text-foreground mb-3">단계별 진행 상태</div>
          <div className="space-y-3.5">
            {categories.map(item => {
              const pct = item.total === 0 ? 0 : Math.round((item.done / item.total) * 100);
              const categoryTasks = tasksByCategory.get(item.category ?? "") ?? [];
              const riskRatio = categoryTasks.length
                ? categoryTasks.filter(task => delayRiskTaskIds.has(task.id)).length / categoryTasks.length
                : 0;
              const color = categoryStatusColor({ total: item.total, done: item.done, riskRatio });
              return (
                <div key={item.category}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-foreground">{item.category}</span>
                    <span className="font-semibold" style={{ color }}>{pct}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full"><div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} /></div>
                </div>
              );
            })}
            {(loading || categories.length === 0) && (
              <div className="text-sm text-muted-foreground">
                {loading ? "데이터를 불러오는 중입니다" : "카테고리 데이터가 없습니다."}
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground mb-2">상태 범례</div>
            <div className="space-y-1.5">
              {STATUS_LEGEND.map(item => (
                <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-sm font-semibold text-foreground">마일스톤 진행 현황</div>
          <button onClick={() => setShowMilestonePopup(true)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">
            <Plus className="w-3.5 h-3.5" /> 마일스톤 추가
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["ID", "마일스톤", "마감일", "상태", "진행률", "관련 업무", "액션"].map(header => (
                <th key={header} className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {milestones.map(item => {
              const status = MILESTONE_STATUS_MAP[normalizeMilestoneStatus(item.status)];
              return (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{item.id}</td>
                  <td className="px-4 py-3 text-xs font-medium text-foreground">{item.title}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDashboardDueDate(item.dueDate)}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${item.progressPercent}%`, background: item.progressPercent === 100 ? "#10B981" : item.progressPercent > 0 ? "#3B5BDB" : "#C1C9D9" }} /></div>
                      <span className="text-xs font-semibold text-foreground">{item.progressPercent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{item.taskCount > 0 ? `${item.taskCount}개` : "-"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate("/dashboard/all-tasks")} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">업무 보기</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(loading || milestones.length === 0) && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {loading ? "데이터를 불러오는 중입니다" : "마일스톤 데이터가 없습니다."}
          </div>
        )}
      </div>

      {showMilestonePopup && currentProjectId != null && (
        <MilestoneAddPopup
          projectId={currentProjectId}
          onClose={() => setShowMilestonePopup(false)}
          onCreated={() => { setShowMilestonePopup(false); refetch(); }}
        />
      )}
    </div>
  );
}
