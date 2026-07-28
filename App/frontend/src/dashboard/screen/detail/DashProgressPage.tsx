import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { AlertTriangle, Calendar, Check, Clock, Sparkles, Target, Plus, X } from "lucide-react";
import { PriorityBadge } from "../../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../../board/components/TaskStatusPill";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { queryRag } from "../../../ai/libs/utils/ragApi";
import { notifyProgressReportReady } from "../../../global/api/notificationApi";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import type { TaskStatus } from "../../../board/libs/types/task";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { MilestoneAddPopup } from "../../components/MilestoneAddPopup";
import { TaskDetailPopup } from "../../components/TaskDetailPopup";
import { deleteMilestone, updateMilestone } from "../../libs/utils/milestoneApi";
import {
  ProgressFrequencyChart,
  buildYTicks,
  dateKeyOf,
  CHART_MARGIN_BOTTOM,
  CHART_MARGIN_TOP,
  FREQUENCY_WINDOW_DAYS,
  Y_TICK_SEGMENTS,
} from "../../components/ProgressFrequencyChart";
import {
  daysUntilDue,
  expectedProgressPercent,
  formatDashboardDueDate,
  formatDDay,
  isDelayRisk,
  normalizePriority,
  normalizeTaskStatus,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay, stableColorForId } from "../../libs/utils/memberDisplay";
import type { DashboardTaskDto, MilestoneProgressDto } from "../../libs/types/dashboard";

const MILESTONE_STATUS_MAP: Record<TaskStatus, { cls: string; label: string }> = {
  done: { cls: "bg-emerald-100 text-emerald-700", label: "완료" },
  inprogress: { cls: "bg-blue-100 text-blue-700", label: "진행 중" },
  todo: { cls: "bg-slate-100 text-slate-500", label: "예정" },
  blocked: { cls: "bg-red-100 text-red-700", label: "지연" },
};

// 퍼센트/flex 체인 대신 확정 픽셀 높이를 매 depth마다 그대로 내려써서
// ResponsiveContainer의 부모 높이 측정 모호성을 없앤다 (ProgressFrequencyChart와 동일한 이유).
const DAILY_CHART_HEIGHT = 160;

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
 * '전체 진행률' 선 그래프와 동일하게 오늘 완료가 없어도 '오늘'을 마지막 포인트로 포함시킨다. */
function buildDailyCompletionChart(
  tasks: DashboardTaskDto[],
  projectStart: string | null,
  projectDeadline: string | null
): { points: DailyCompletionPoint[]; members: DailyCompletionMember[] } {
  if (!projectStart) return { points: [], members: [] };
  const rangeStart = dateKeyOf(projectStart);
  const rangeEnd = projectDeadline ? dateKeyOf(projectDeadline) : dateKeyOf(new Date().toISOString());
  const todayKey = dateKeyOf(new Date().toISOString());

  const doneTasks = tasks.filter(task => normalizeTaskStatus(task.status) === "done" && task.doneDate);

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
  doneTasks.forEach(task => changeDates.add(dateKeyOf(task.doneDate as string)));
  if (todayKey >= rangeStart && todayKey <= rangeEnd) changeDates.add(todayKey);
  const sortedDates = Array.from(changeDates).filter(dateKey => dateKey >= rangeStart && dateKey <= rangeEnd).sort();

  const points = sortedDates.map(dateKey => {
    const point: DailyCompletionPoint = { dateKey, label: dateKey === todayKey ? "오늘" : formatDashboardDueDate(dateKey) };
    members.forEach(member => { point[member.key] = 0; });
    doneTasks.forEach(task => {
      if (dateKeyOf(task.doneDate as string) === dateKey) {
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
  const { user, currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const onGoUrgent = () => navigate("/dashboard/urgent");
  const { data: progress, loading, error, refetch } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoading } = useDashboardTasks(currentProjectId);
  const [showMilestonePopup, setShowMilestonePopup] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DashboardTaskDto | null>(null);
  const [milestoneTasksTarget, setMilestoneTasksTarget] = useState<MilestoneProgressDto | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEdits, setBulkEdits] = useState<Record<string, { title: string; startDate: string; dueDate: string }>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // 추가/수정/삭제 직후 refetch()가 끝날 때까지, 기존 목록 대신 "불러오는 중" 문구만 보여준다
  // (그대로 두면 새 데이터가 도착하기 전까지 옛 데이터가 계속 보여서 반영 안 된 것처럼 보였다).
  const [milestoneRefreshing, setMilestoneRefreshing] = useState(false);

  const totalTasks = progress?.totalTasks ?? 0;
  const doneTasks = progress?.doneTasks ?? 0;
  const progressPercent = progress?.progressPercent ?? 0;
  const delayRisks = progress?.delayRisks.filter(risk => isDelayRisk(risk.result)) ?? [];
  const delayRiskTaskIds = new Set(delayRisks.map(risk => risk.taskId));
  // '지연 업무'는 ML 예측이 아니라, 완료되지 않은 채 마감일이 실제로 지난 업무 수를 그대로 센다.
  const overdueTaskCount = tasks.filter(task => {
    const days = daysUntilDue(task.dueDate);
    return normalizeTaskStatus(task.status) !== "done" && days != null && days < 0;
  }).length;
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
  const insightPrompt = `현재 프로젝트의 진행률 보고서를 만들어 줘. 실제 완료율은 ${progressPercent}%, 계획상 예상 진행률은 ${expectedProgress ?? "미정"}%, 지연 주의·위험 업무는 ${delayRisks.length}개, 프로젝트 마감은 ${projectDDay}(이)야. 진행 상황을 분석하고, 계획 대비 차이와 주요 위험, 권장 조치를 정리해줘. 출력은 PDF 형식으로 해.`;
  const insightFallback = "계획 대비 진행률과 지연 예측을 바탕으로 다음 액션을 추천받을 수 있습니다.";

  const { points: dailyCompletionPoints, members: dailyCompletionMembers } = buildDailyCompletionChart(
    tasks,
    projectCreatedAt,
    projectDeadline
  );
  // 한 화면(윈도우)에는 항상 7일치만 보이게 한다 (ProgressFrequencyChart와 동일한 기준 — %기반이라 빈 여백이 남지 않는다).
  const chartsFillFullWidth = dailyCompletionPoints.length <= FREQUENCY_WINDOW_DAYS;
  const dailyChartWidthPercent = chartsFillFullWidth ? 100 : (dailyCompletionPoints.length / FREQUENCY_WINDOW_DAYS) * 100;
  const dailyCompletionYMax = Math.max(
    ...dailyCompletionPoints.map(point => dailyCompletionMembers.reduce((sum, member) => sum + (point[member.key] as number), 0)),
    1
  );
  const handleGenerateReport = async () => {
    if (currentProjectId == null || generatingReport) return;
    openAIAssistant(insightPrompt);
    setGeneratingReport(true);
    try {
      const { answer } = await queryRag(currentProjectId, insightPrompt);
      await notifyProgressReportReady(
        answer.length > 200 ? `${answer.slice(0, 200)}...` : answer,
        currentProjectId
      );
    } catch {
      // 알림 전송 실패는 조용히 무시한다 — 보고서 자체는 이미 AI 어시스턴트 패널에 표시된다.
    } finally {
      setGeneratingReport(false);
    }
  };

  const enterBulkEditMode = () => {
    const initial: Record<string, { title: string; startDate: string; dueDate: string }> = {};
    milestones.forEach(item => {
      initial[item.id] = { title: item.title, startDate: item.startDate ?? "", dueDate: item.dueDate ?? "" };
    });
    setBulkEdits(initial);
    setBulkSelectedIds(new Set());
    setBulkError(null);
    setBulkEditMode(true);
  };

  const exitBulkEditMode = () => {
    setBulkEditMode(false);
    setBulkSelectedIds(new Set());
    setBulkEdits({});
    setBulkError(null);
  };

  const toggleBulkSelectAll = () => {
    setBulkSelectedIds(prev => (prev.size === milestones.length ? new Set() : new Set(milestones.map(item => item.id))));
  };

  const toggleBulkSelectRow = (id: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitBulkEdit = async () => {
    if (currentProjectId == null) return;
    for (const item of milestones) {
      const edit = bulkEdits[item.id];
      if (!edit) continue;
      if (!edit.title.trim()) {
        setBulkError(`'${item.title}'의 마일스톤 이름을 입력해주세요.`);
        return;
      }
      if (edit.startDate && edit.dueDate && edit.startDate > edit.dueDate) {
        setBulkError(`'${edit.title}'의 시작일은 마감일보다 늦을 수 없습니다.`);
        return;
      }
    }
    if (!window.confirm("변경사항을 반영할까요?")) return;
    setBulkError(null);
    setBulkSubmitting(true);
    try {
      const changed = milestones.filter(item => {
        const edit = bulkEdits[item.id];
        if (!edit) return false;
        return edit.title !== item.title || edit.startDate !== (item.startDate ?? "") || edit.dueDate !== (item.dueDate ?? "");
      });
      const results = await Promise.allSettled(changed.map(item => {
        const edit = bulkEdits[item.id];
        return updateMilestone(currentProjectId, item.id, {
          title: edit.title.trim(),
          startDate: edit.startDate || null,
          dueDate: edit.dueDate || null,
        });
      }));
      const failedCount = results.filter(result => result.status === "rejected").length;
      // 일부만 실패해도 성공한 나머지는 이미 서버에 반영됐으므로, 우선 화면을 최신 상태로 맞춘다.
      // refetch 자체가 실패하더라도 로딩 표시가 고착되지 않도록 finally로 반드시 해제한다.
      setMilestoneRefreshing(true);
      try {
        await refetch();
      } finally {
        setMilestoneRefreshing(false);
      }
      if (failedCount > 0) {
        setBulkError(`${changed.length}개 중 ${failedCount}개 수정에 실패했습니다. 다시 시도해주세요.`);
      } else {
        exitBulkEditMode();
      }
    } catch {
      setBulkError("마일스톤 수정에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const submitBulkDelete = async () => {
    if (currentProjectId == null) return;
    if (bulkSelectedIds.size === 0) {
      setBulkError("삭제할 마일스톤을 선택해주세요.");
      return;
    }
    if (!window.confirm(`선택한 마일스톤 ${bulkSelectedIds.size}개를 삭제할까요?`)) return;
    setBulkError(null);
    setBulkSubmitting(true);
    try {
      const ids = Array.from(bulkSelectedIds);
      const results = await Promise.allSettled(ids.map(id => deleteMilestone(currentProjectId, id)));
      const failedIds = ids.filter((_, index) => results[index].status === "rejected");
      // 일부만 실패해도 성공한 나머지는 이미 삭제됐으므로, 우선 화면을 최신 상태로 맞춘다.
      // refetch 자체가 실패하더라도 로딩 표시가 고착되지 않도록 finally로 반드시 해제한다.
      setMilestoneRefreshing(true);
      try {
        await refetch();
      } finally {
        setMilestoneRefreshing(false);
      }
      if (failedIds.length > 0) {
        setBulkSelectedIds(new Set(failedIds));
        setBulkError(`${ids.length}개 중 ${failedIds.length}개 삭제에 실패했습니다. 다시 시도해주세요.`);
      } else {
        exitBulkEditMode();
      }
    } catch {
      setBulkError("마일스톤 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const dailyCompletionScrollRef = useRef<HTMLDivElement>(null);
  const dailyCompletionSvgRef = useRef<SVGSVGElement>(null);
  const [dailyHoverIndex, setDailyHoverIndex] = useState<number | null>(null);
  const [dailyHoverPos, setDailyHoverPos] = useState<{ x: number; y: number } | null>(null);

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
          <button onClick={onGoUrgent} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-red-200 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"><AlertTriangle className="w-3.5 h-3.5" />마감 임박 업무</button>
          {/* <button onClick={handleGenerateReport} disabled={generatingReport} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-60" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
            <Sparkles className="w-3.5 h-3.5" />{generatingReport ? "생성 중..." : "진행률 보고서"}
          </button> */}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3">
        <DetailStatCard label="전체 완료율" value={loading ? "..." : `${progressPercent}%`} sub={loading ? "불러오는 중" : `${doneTasks} / ${totalTasks} 완료`} color="#3B5BDB" icon={Target} />
        <DetailStatCard label="지연 업무" value={loading || tasksLoading ? "..." : `${overdueTaskCount}개`} sub="마감일 경과 · 미완료" color="#EF4444" icon={Clock} />
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
              <div className="text-sm font-semibold text-foreground">전체 진행률</div>
            </div>
            <div className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{loading ? "..." : progressPercent}%</div>
          </div>
          <div className="text-right text-[10px] text-muted-foreground mb-1">기준: 주별 완료 업무 수</div>
          <div className="h-40" style={{marginBottom: 80}}>
            <ProgressFrequencyChart
              tasks={tasks}
              projectStart={projectCreatedAt}
              projectDeadline={projectDeadline}
              totalTasks={totalTasks}
              loading={loading || tasksLoading}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-border" style={{marginBottom: 0}}>
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
            <div className="flex" style={{ height: DAILY_CHART_HEIGHT }}>
              {loading || tasksLoading ? (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">데이터를 불러오는 중입니다</div>
              ) : dailyCompletionPoints.length ? (
                <>
                  <div className="w-10 shrink-0 relative" style={{ height: DAILY_CHART_HEIGHT }}>
                    <span className="absolute top-0 left-0.5 text-[9px] leading-none text-muted-foreground">(개)</span>
                    <div
                      className="absolute left-0 right-1 flex flex-col justify-between text-right text-[10px] text-muted-foreground"
                      style={{ top: CHART_MARGIN_TOP, bottom: CHART_MARGIN_BOTTOM }}
                    >
                      {buildYTicks(dailyCompletionYMax, Y_TICK_SEGMENTS).map(tick => <span key={tick}>{tick}</span>)}
                    </div>
                  </div>
                  {(() => {
                    const n = dailyCompletionPoints.length;
                    const plotHeight = DAILY_CHART_HEIGHT - CHART_MARGIN_TOP - CHART_MARGIN_BOTTOM;
                    const bottomY = CHART_MARGIN_TOP + plotHeight;
                    const viewBoxWidth = 1000;
                    const bandWidth = viewBoxWidth / n;
                    const barWidth = bandWidth * 0.5;
                    const yFor = (value: number) => {
                      const ratio = dailyCompletionYMax <= 0 ? 0 : value / dailyCompletionYMax;
                      return CHART_MARGIN_TOP + (1 - ratio) * plotHeight;
                    };
                    const handleDailyMove = (event: ReactMouseEvent<SVGSVGElement>) => {
                      const svg = dailyCompletionSvgRef.current;
                      if (!svg || n === 0) return;
                      const rect = svg.getBoundingClientRect();
                      const localX = (event.clientX - rect.left) * (viewBoxWidth / rect.width);
                      const index = Math.min(n - 1, Math.max(0, Math.floor(localX / bandWidth)));
                      setDailyHoverIndex(index);
                      // 뷰포트 기준 좌표로 저장 — position:fixed 포털로 그려서 다른 요소에 가려지지 않게 한다.
                      setDailyHoverPos({ x: event.clientX, y: rect.top + 4 });
                    };
                    const hoverPoint = dailyHoverIndex != null ? dailyCompletionPoints[dailyHoverIndex] : null;
                    return (
                      <div
                        ref={dailyCompletionScrollRef}
                        className={`scrollbar-none ${chartsFillFullWidth ? "flex-1 relative overflow-hidden" : "flex-1 overflow-x-auto overflow-y-hidden cursor-grab relative"}`}
                        style={{ height: DAILY_CHART_HEIGHT }}
                      >
                        <div style={{ width: `${dailyChartWidthPercent}%`, height: DAILY_CHART_HEIGHT }}>
                          <svg
                            ref={dailyCompletionSvgRef}
                            width="100%"
                            height={DAILY_CHART_HEIGHT}
                            viewBox={`0 0 ${viewBoxWidth} ${DAILY_CHART_HEIGHT}`}
                            preserveAspectRatio="none"
                            onMouseMove={handleDailyMove}
                            onMouseLeave={() => { setDailyHoverIndex(null); setDailyHoverPos(null); }}
                          >
                            {buildYTicks(dailyCompletionYMax, Y_TICK_SEGMENTS).map(tick => (
                              <line key={tick} x1={0} x2={viewBoxWidth} y1={yFor(tick)} y2={yFor(tick)} stroke="rgba(0,0,0,0.06)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                            ))}
                            {dailyCompletionPoints.map((point, i) => {
                              let cumulative = 0;
                              const cx = i * bandWidth + bandWidth / 2;
                              return (
                                <g key={point.dateKey}>
                                  {dailyCompletionMembers.map(member => {
                                    const value = point[member.key] as number;
                                    if (value <= 0) return null;
                                    const y0 = yFor(cumulative);
                                    cumulative += value;
                                    const y1 = yFor(cumulative);
                                    return (
                                      <rect key={member.key} x={cx - barWidth / 2} y={y1} width={barWidth} height={Math.max(y0 - y1, 0)} fill={member.color} rx={2} />
                                    );
                                  })}
                                  <text x={cx} y={bottomY + 14} textAnchor="middle" fontSize={10} fill="#8892A4">{point.label}</text>
                                </g>
                              );
                            })}
                            {dailyHoverIndex != null && (
                              <rect x={dailyHoverIndex * bandWidth} y={CHART_MARGIN_TOP} width={bandWidth} height={plotHeight} fill="rgba(59,91,219,0.05)" />
                            )}
                            {/* x축 라인 — 항상 플롯 영역의 진짜 바닥(bottomY)에 고정 */}
                            <line x1={0} x2={viewBoxWidth} y1={bottomY} y2={bottomY} stroke="#94A3B8" vectorEffect="non-scaling-stroke" />
                          </svg>
                          {hoverPoint && dailyHoverPos && createPortal(
                            <div
                              className="fixed pointer-events-none"
                              style={{ left: dailyHoverPos.x, top: dailyHoverPos.y, transform: "translateX(-50%)", zIndex: 9999 }}
                            >
                              <DailyCompletionTooltip
                                active
                                label={hoverPoint.dateKey === dateKeyOf(new Date().toISOString()) ? `오늘 (${hoverPoint.dateKey})` : hoverPoint.label}
                                members={dailyCompletionMembers}
                                payload={dailyCompletionMembers.map(member => ({ dataKey: member.key, value: hoverPoint[member.key] as number }))}
                              />
                            </div>,
                            document.body
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="w-6 shrink-0 relative" style={{ height: DAILY_CHART_HEIGHT }}>
                    <span className="absolute bottom-0 right-0 text-[9px] leading-none text-muted-foreground">(일)</span>
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
            {!loading && categories.map(item => {
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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">마일스톤 진행 현황</span>
            {bulkEditMode && <span className="text-[11px] text-muted-foreground">{bulkSelectedIds.size}개 선택됨</span>}
          </div>
          <div className="flex items-center gap-2">
            {!bulkEditMode && isLeader && (
              <>
                <button onClick={enterBulkEditMode} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">
                  마일스톤 수정/삭제
                </button>
                <button onClick={() => setShowMilestonePopup(true)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">
                  <Plus className="w-3.5 h-3.5" /> 마일스톤 추가
                </button>
              </>
            )}
          </div>
        </div>

        {bulkEditMode && bulkError && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-amber-50/60">
            <span className="text-[11px] text-red-600">{bulkError}</span>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {bulkEditMode && (
                <th className="pl-4 pr-2 py-2.5 w-8">
                  <button onClick={toggleBulkSelectAll} className={`w-4 h-4 rounded border flex items-center justify-center ${bulkSelectedIds.size === milestones.length && milestones.length > 0 ? "border-blue-500 bg-blue-500" : "border-border"}`}>
                    {bulkSelectedIds.size === milestones.length && milestones.length > 0 && <Check className="w-2.5 h-2.5 text-white" />}
                  </button>
                </th>
              )}
              {["ID", "마일스톤", "시작일", "마감일", "상태", "진행률", "액션"].map(header => (
                <th key={header} className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!loading && !milestoneRefreshing && milestones.map(item => {
              const status = MILESTONE_STATUS_MAP[normalizeMilestoneStatus(item.status)];
              const edit = bulkEdits[item.id];
              const isSelected = bulkSelectedIds.has(item.id);
              return (
                <tr key={item.id} className={`hover:bg-muted/30 transition-colors ${isSelected ? "bg-blue-50/40" : ""}`}>
                  {bulkEditMode && (
                    <td className="pl-4 pr-2 py-3">
                      <button onClick={() => toggleBulkSelectRow(item.id)} className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "border-blue-500 bg-blue-500" : "border-border"}`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{item.id}</td>
                  <td className="px-4 py-3 text-xs font-medium text-foreground">
                    {bulkEditMode ? (
                      <input
                        value={edit?.title ?? ""}
                        onChange={e => setBulkEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], title: e.target.value } }))}
                        className="w-full rounded-lg border border-border bg-input-background px-2 py-1 text-xs outline-none focus:border-blue-400"
                      />
                    ) : item.title}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {bulkEditMode ? (
                      <input
                        type="date"
                        value={edit?.startDate ?? ""}
                        onChange={e => setBulkEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], startDate: e.target.value } }))}
                        className="w-full rounded-lg border border-border bg-input-background px-2 py-1 text-xs outline-none focus:border-blue-400"
                      />
                    ) : formatDashboardDueDate(item.startDate)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {bulkEditMode ? (
                      <input
                        type="date"
                        value={edit?.dueDate ?? ""}
                        onChange={e => setBulkEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], dueDate: e.target.value } }))}
                        className="w-full rounded-lg border border-border bg-input-background px-2 py-1 text-xs outline-none focus:border-blue-400"
                      />
                    ) : formatDashboardDueDate(item.dueDate)}
                  </td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span></td>
                  <td className="px-4 py-3">
                    {(() => {
                      const gaugeColor = stableColorForId(item.id);
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground w-9 text-right shrink-0">{item.progressPercent}%</span>
                          <div className="w-36 h-6 bg-muted rounded-full shadow-inner relative overflow-hidden">
                            <div
                              className="h-6 rounded-full shadow-sm transition-all"
                              style={{
                                width: `${Math.max(item.progressPercent, 6)}%`,
                                background: `linear-gradient(90deg, ${gaugeColor}, ${gaugeColor}CC)`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setMilestoneTasksTarget(item)}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                    >
                      업무 보기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(loading || milestoneRefreshing || milestones.length === 0) && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {loading || milestoneRefreshing ? "데이터를 불러오는 중입니다" : "마일스톤 데이터가 없습니다."}
          </div>
        )}
        {bulkEditMode && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
            <button onClick={exitBulkEditMode} disabled={bulkSubmitting} className="px-4 py-2 text-xs font-medium text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
              취소
            </button>
            <button onClick={submitBulkEdit} disabled={bulkSubmitting} className="px-4 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50" style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
              {bulkSubmitting ? "처리 중..." : "수정"}
            </button>
            <button onClick={submitBulkDelete} disabled={bulkSubmitting} className="px-4 py-2 text-xs font-semibold text-white rounded-lg bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50">
              {bulkSubmitting ? "처리 중..." : "삭제"}
            </button>
          </div>
        )}
      </div>

      {showMilestonePopup && currentProjectId != null && (
        <MilestoneAddPopup
          projectId={currentProjectId}
          onClose={() => setShowMilestonePopup(false)}
          onCreated={async () => { setShowMilestonePopup(false); setMilestoneRefreshing(true); await refetch(); setMilestoneRefreshing(false); }}
        />
      )}
      {detailTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={detailTarget}
          projectId={currentProjectId}
          onClose={() => setDetailTarget(null)}
        />
      )}
      {milestoneTasksTarget && (() => {
        const milestoneTasks = tasks.filter(t => milestoneTasksTarget.taskIds.includes(t.id));
        return (
          <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setMilestoneTasksTarget(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{milestoneTasksTarget.title}의 업무 목록</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{tasksLoading ? "불러오는 중" : `${milestoneTasks.length}개 업무`}</p>
                  </div>
                  <button onClick={() => setMilestoneTasksTarget(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-muted/40 shrink-0">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-10 shrink-0">ID</span>
                  <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">업무명</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-16 text-center shrink-0">상태</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-14 text-center shrink-0">우선순위</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-14 text-right shrink-0">담당자</span>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-border">
                  {!tasksLoading && milestoneTasks.map((task, index) => (
                    <button
                      key={task.id}
                      onClick={() => { setDetailTarget(task); setMilestoneTasksTarget(null); }}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-10 shrink-0">{task.id}</span>
                      <span className="flex-1 text-xs font-medium text-foreground truncate">{task.title}</span>
                      <TaskStatusPill status={normalizeTaskStatus(task.status)} />
                      <PriorityBadge priority={normalizePriority(task.priority)} />
                      <span className="text-[10px] text-muted-foreground w-14 text-right shrink-0">{taskAssignee(task, index).name}</span>
                    </button>
                  ))}
                  {(tasksLoading || milestoneTasks.length === 0) && (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      {tasksLoading ? "데이터를 불러오는 중입니다." : "연결된 업무가 없습니다."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
