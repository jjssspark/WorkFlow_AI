import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Calendar, CheckCircle2, CheckSquare, RefreshCw, TrendingUp, X } from "lucide-react";
import { BackBtn } from "../../../global/component/BackBtn";
import { CircleProgress } from "../../../global/component/CircleProgress";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { PriorityBadge } from "../../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../../board/components/TaskStatusPill";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardSummary } from "../../libs/hooks/useDashboardSummary";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { TaskDetailPopup } from "../../components/TaskDetailPopup";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";
import type { DashboardTaskDto, MilestoneProgressDto } from "../../libs/types/dashboard";
import {
  daysSince,
  formatDDay,
  formatDashboardDueDate,
  normalizePriority,
  normalizeTaskStatus,
  parseKstDateTime,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay, stableColorForId } from "../../libs/utils/memberDisplay";

const CATEGORY_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"];

export function ProgressPage() {
  const { currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: summary, loading: summaryLoadingRaw, error: summaryError, refetch: refetchSummary } = useDashboardSummary(currentProjectId);
  const { data: progress, loading: progressLoadingRaw, error: progressError, refetch: refetchProgress } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoadingRaw, refetch: refetchTasks } = useDashboardTasks(currentProjectId);
  const [hoveredMilestoneId, setHoveredMilestoneId] = useState<string | null>(null);
  const [milestoneHoverPos, setMilestoneHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  // 새로고침 버튼을 누른 동안은 각 데이터 영역이 "데이터를 불러오는 중입니다"로 보이도록,
  // 개별 훅의 loading 상태에 pageRefreshing을 합쳐서 쓴다.
  const loading = progressLoadingRaw || pageRefreshing;
  const summaryLoading = summaryLoadingRaw || pageRefreshing;
  const tasksLoading = tasksLoadingRaw || pageRefreshing;
  const refreshAll = async () => {
    setPageRefreshing(true);
    await Promise.all([refetchSummary(), refetchProgress(), refetchTasks()]);
    setPageRefreshing(false);
  };
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  // 업무 제목 클릭시, 업무 상세창 팝업
  const [detailTarget, setDetailTarget] = useState<{ task: DashboardTaskDto; focusComments: boolean } | null>(null);
  // 마일스톤 제목 클릭시, 해당 마일스톤의 업무 목록 팝업
  const [milestoneTasksTarget, setMilestoneTasksTarget] = useState<MilestoneProgressDto | null>(null);
  // 담당자 이름 클릭시, 그 담당자의 업무 목록 팝업
  const [assigneeTasksTarget, setAssigneeTasksTarget] = useState<{ assigneeId: string; name: string } | null>(null);
  // 카테고리 이름 클릭시, 그 카테고리의 업무 목록 팝업
  const [categoryTasksTarget, setCategoryTasksTarget] = useState<string | null>(null);

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


  const totalTasks = progress?.totalTasks ?? summary?.totalTasks ?? 0;
  const doneTasks = progress?.doneTasks ?? summary?.doneTasks ?? 0;
  const progressPercent = progress?.progressPercent ?? summary?.progressPercent ?? 0;
  const openTasks = Math.max(totalTasks - doneTasks, 0);
  const blockedCount = summary?.blockedTasks ?? 0;
  const doneThisWeekRows = tasks
    .filter(task => normalizeTaskStatus(task.status) === "done" && (daysSince(task.doneDate) ?? Infinity) <= 7)
    .slice(0, 5);
  const workload = summary?.workload ?? [];
  const categoryBreakdown = progress?.categoryBreakdown ?? [];
  const milestones = progress?.milestones ?? [];
  // 마일스톤에 시작일(startDate)이 입력돼 있으면 그대로 쓰고, 없는(과거) 마일스톤만
  // 생성일(createdAt)을 시작일 근사치로 쓴다.
  const timelineMilestones = milestones
    .slice(0, 6)
    .filter(item => (item.startDate || item.createdAt) && item.dueDate)
    .map(item => ({
      ...item,
      start: item.startDate
        ? new Date(`${item.startDate}T00:00:00+09:00`).getTime()
        : parseKstDateTime(item.createdAt as string).getTime(),
      end: new Date(`${item.dueDate}T00:00:00+09:00`).getTime(),
    }));
  const now = Date.now();
  const timelineRangeStart = timelineMilestones.length ? Math.min(...timelineMilestones.map(m => m.start), now) : now;
  const timelineRangeEnd = timelineMilestones.length ? Math.max(...timelineMilestones.map(m => m.end), now) : now;
  // 마일스톤 일정표는 항상 1월~12월 고정 12칸으로 보여준다(마일스톤 시작연도 기준, 없으면 올해).
  const chartYear = timelineMilestones.length ? new Date(timelineRangeStart).getFullYear() : new Date(now).getFullYear();
  const yearRangeStart = new Date(chartYear, 0, 1).getTime();
  const yearRangeEnd = new Date(chartYear, 11, 31, 23, 59, 59).getTime();
  const yearRangeSpan = yearRangeEnd - yearRangeStart;
  const todayPct = Math.min(Math.max(((now - yearRangeStart) / yearRangeSpan) * 100, 0), 100);
  const monthBuckets = Array.from({ length: 12 }, (_, month) => ({ key: `${chartYear}-${month}`, label: `${month + 1}월` }));
  const projectDDay = formatDDay(progress?.projectDeadline);
  const error = summaryError ?? progressError;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">진행률 분석</h1>
          <p className="text-sm text-muted-foreground mt-0.5">업무와 마일스톤 기준으로 완료 현황을 분석합니다.</p>
        </div>
        <button
          onClick={refreshAll}
          disabled={pageRefreshing}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${pageRefreshing ? "animate-spin" : ""}`} />{pageRefreshing ? "새로고침 중..." : "새로고침"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-4 gap-3">
        <DetailStatCard label="전체 완료율" value={loading ? "..." : `${progressPercent}%`} sub={loading ? "불러오는 중" : `${doneTasks} / ${totalTasks} 완료`} color="#3B5BDB" icon={TrendingUp} />
        <DetailStatCard label="완료" value={loading ? "..." : `${doneTasks}개`} sub="완료 상태 업무" color="#10B981" icon={CheckCircle2} />
        <DetailStatCard label="목표 완료율" value="100%" sub={progress?.projectDeadline ? formatDashboardDueDate(progress.projectDeadline) : "마감일 미정"} color="#7048E8" icon={CheckSquare} />
        <DetailStatCard label="D-day" value={loading ? "..." : projectDDay} sub={formatDashboardDueDate(progress?.projectDeadline)} color="#F59E0B" icon={Calendar} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <CircleProgress
              pct={loading ? 0 : progressPercent}
              size={156}
              segments={loading ? undefined : [
                { value: doneTasks, color: "#3B5BDB" },
                { value: blockedCount, color: "#EF4444" },
                { value: Math.max(openTasks - blockedCount, 0), color: "#C1C9D9" },
              ]}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-3xl font-bold text-foreground">{loading ? "..." : `${progressPercent}%`}</div>
              <div className="text-[11px] text-muted-foreground">완료율</div>
            </div>
          </div>
          <div className="w-full border-t border-border pt-3 space-y-2">
            {[
              { label: "완료", count: doneTasks, color: "#3B5BDB" },
              { label: "미완료", count: openTasks, color: "#C1C9D9" },
              { label: "블로커", count: blockedCount, color: "#EF4444" },
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
          <div className="bg-card rounded-xl p-4 border border-border shadow-sm flex-1 flex flex-col">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 cursor-pointer">이번 주 완료된 업무</div>
            <div className="flex-1">
              {doneThisWeekRows.map((task, index) => {
                const member = taskAssignee(task, index);
                return (
                  <div key={task.id} className="flex items-center gap-2 py-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span onClick={() => setDetailTarget({ task, focusComments: false })} className="text-xs text-foreground truncate flex-1 hover:text-blue-700 cursor-pointer">{task.title}</span>
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
                      <span
                        onClick={() => setAssigneeTasksTarget({ assigneeId: entry.assigneeId, name: member.name })}
                        className="font-medium text-foreground cursor-pointer hover:text-blue-700"
                      >
                        {member.name}
                      </span>
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
            <div className="text-sm font-semibold text-foreground">업무 카테고리별 완료율</div>
            <button onClick={() => navigate("/dashboard/all-tasks")} className="text-[11px] font-medium text-blue-600">업무 보기</button>
          </div>
          <div className="divide-y divide-border">
            {categoryBreakdown.map((item, index) => {
              const pct = item.total === 0 ? 0 : Math.round((item.done / item.total) * 100);
              const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
              return (
                <div key={item.category} className="flex items-center gap-3 px-5 py-2.5">
                  <div
                    onClick={() => setCategoryTasksTarget(item.category)}
                    className="w-20 text-xs font-medium text-foreground shrink-0 truncate cursor-pointer hover:text-blue-700"
                  >
                    {item.category}
                  </div>
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
          <div className="p-4">
            {timelineMilestones.length > 0 ? (
              <div>
                {/* 범례 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 pb-3 border-b border-border">
                  {timelineMilestones.map(item => (
                    <span key={item.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: stableColorForId(item.id) }} />
                      {item.title}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
                    <span className="w-2.5 h-px bg-blue-400" />오늘
                  </span>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* 월 헤더 행 */}
                  <div className="flex bg-muted/40">
                    <div className="w-32 shrink-0 border-r border-border" />
                    <div className="flex-1 flex">
                      {monthBuckets.map(month => (
                        <div key={month.key} className="flex-1 text-center text-[10px] font-semibold text-muted-foreground py-1.5 border-l border-border first:border-l-0">
                          {month.label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="relative">
                    {/* 월 경계 세로선 + 오늘 세로선 (라벨 칸(w-32)만큼 밀어서 막대 영역과 좌표계를 맞춘다) */}
                    <div className="absolute top-0 bottom-0 left-32 right-0 flex pointer-events-none">
                      {monthBuckets.map(month => (
                        <div key={month.key} className="flex-1 border-l border-border/60 first:border-l-0" />
                      ))}
                    </div>
                    <div className="absolute top-0 bottom-0 left-32 right-0 pointer-events-none">
                      <div className="absolute top-0 bottom-0 w-px bg-blue-400 z-10" style={{ left: `${todayPct}%` }} />
                    </div>
                    <div className="space-y-1.5 p-2">
                  {timelineMilestones.map(item => {
                    const color = stableColorForId(item.id);
                    const leftPct = Math.max(((item.start - yearRangeStart) / yearRangeSpan) * 100, 0);
                    const widthPct = Math.max(((Math.min(item.end, yearRangeEnd) - item.start) / yearRangeSpan) * 100, 1.5);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-0 h-6"
                        onMouseMove={(event: ReactMouseEvent<HTMLDivElement>) => {
                          setHoveredMilestoneId(item.id);
                          setMilestoneHoverPos({ x: event.clientX, y: event.clientY });
                        }}
                        onMouseLeave={() => { setHoveredMilestoneId(null); setMilestoneHoverPos(null); }}
                      >
                        <div
                          onClick={() => setMilestoneTasksTarget(item)}
                          className="w-32 shrink-0 pr-2 text-[10px] font-medium text-foreground truncate flex items-center gap-1.5 cursor-pointer hover:text-blue-700"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                          {item.title}
                        </div>
                        <div className="flex-1 h-5 relative">
                          <div className="absolute top-0 h-5 rounded bg-muted" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                          <div
                            className="absolute top-0 h-5 rounded flex items-center justify-end px-1"
                            style={{ left: `${leftPct}%`, width: `${widthPct * item.progressPercent / 100}%`, background: color }}
                          />
                          <span
                            className="absolute top-0 h-5 flex items-center text-[9px] font-semibold text-foreground pl-1"
                            style={{ left: `calc(${leftPct}% + ${widthPct}% + 2px)` }}
                          >
                            {item.progressPercent}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  </div>
                </div>
                {hoveredMilestoneId && milestoneHoverPos && (() => {
                  const hovered = timelineMilestones.find(m => m.id === hoveredMilestoneId);
                  if (!hovered) return null;
                  return createPortal(
                    <div
                      className="fixed rounded-lg bg-white shadow-lg border border-border px-3 py-2 text-[11px] space-y-0.5 pointer-events-none z-[9999]"
                      style={{ left: milestoneHoverPos.x + 12, top: milestoneHoverPos.y + 12 }}
                    >
                      <div className="font-semibold text-foreground whitespace-nowrap">{hovered.title}</div>
                      <div className="text-muted-foreground whitespace-nowrap">ID: <span className="font-medium text-foreground">{hovered.id}</span></div>
                      <div className="text-muted-foreground whitespace-nowrap">시작일: <span className="font-medium text-foreground">{formatDashboardDueDate(hovered.startDate)}</span></div>
                      <div className="text-muted-foreground whitespace-nowrap">마감일: <span className="font-medium text-foreground">{formatDashboardDueDate(hovered.dueDate)}</span></div>
                    </div>,
                    document.body
                  );
                })()}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {loading ? "데이터를 불러오는 중입니다" : "일정(생성일/마감일)이 있는 마일스톤이 없습니다."}
              </div>
            )}
          </div>
        </div>
      </div>

      {detailTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={detailTarget.task}
          projectId={currentProjectId}
          focusComments={detailTarget.focusComments}
          onClose={() => setDetailTarget(null)}
          isLeader={isLeader}
          projectMembers={projectMembers}
          onUpdated={() => refetchTasks()}
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
                      onClick={() => { setDetailTarget({ task, focusComments: false }); setMilestoneTasksTarget(null); }}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-10 shrink-0">{task.id}</span>
                      <span className="flex-1 text-xs font-medium text-foreground truncate cursor-pointer">{task.title}</span>
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

      {assigneeTasksTarget && (() => {
        const assigneeTasks = tasks.filter(t => t.assigneeId === assigneeTasksTarget.assigneeId);
        return (
          <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setAssigneeTasksTarget(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{assigneeTasksTarget.name}의 업무 목록</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{tasksLoading ? "불러오는 중" : `${assigneeTasks.length}개 업무`}</p>
                  </div>
                  <button onClick={() => setAssigneeTasksTarget(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-muted/40 shrink-0">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-10 shrink-0">ID</span>
                  <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">업무명</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-16 text-center shrink-0">상태</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-14 text-center shrink-0">우선순위</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-12 text-right shrink-0">마감일</span>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-border">
                  {!tasksLoading && assigneeTasks.map(task => (
                    <button
                      key={task.id}
                      onClick={() => { setDetailTarget({ task, focusComments: false }); setAssigneeTasksTarget(null); }}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-10 shrink-0">{task.id}</span>
                      <span className="flex-1 text-xs font-medium text-foreground truncate cursor-pointer">{task.title}</span>
                      <TaskStatusPill status={normalizeTaskStatus(task.status)} />
                      <PriorityBadge priority={normalizePriority(task.priority)} />
                      <span className="text-[10px] text-muted-foreground w-12 text-right shrink-0">{formatDashboardDueDate(task.dueDate)}</span>
                    </button>
                  ))}
                  {(tasksLoading || assigneeTasks.length === 0) && (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      {tasksLoading ? "데이터를 불러오는 중입니다." : "배정된 업무가 없습니다."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {categoryTasksTarget && (() => {
        const categoryTasks = tasks.filter(t => (t.category ?? "미분류") === categoryTasksTarget);
        return (
          <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setCategoryTasksTarget(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{categoryTasksTarget}의 업무 목록</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{tasksLoading ? "불러오는 중" : `${categoryTasks.length}개 업무`}</p>
                  </div>
                  <button onClick={() => setCategoryTasksTarget(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-muted/40 shrink-0">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-10 shrink-0">ID</span>
                  <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">업무명</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-16 text-center shrink-0">상태</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-14 text-center shrink-0">우선순위</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-14 text-right shrink-0">담당자</span>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-border">
                  {!tasksLoading && categoryTasks.map((task, index) => (
                    <button
                      key={task.id}
                      onClick={() => { setDetailTarget({ task, focusComments: false }); setCategoryTasksTarget(null); }}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-10 shrink-0">{task.id}</span>
                      <span className="flex-1 text-xs font-medium text-foreground truncate cursor-pointer">{task.title}</span>
                      <TaskStatusPill status={normalizeTaskStatus(task.status)} />
                      <PriorityBadge priority={normalizePriority(task.priority)} />
                      <span className="text-[10px] text-muted-foreground w-14 text-right shrink-0">{taskAssignee(task, index).name}</span>
                    </button>
                  ))}
                  {(tasksLoading || categoryTasks.length === 0) && (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      {tasksLoading ? "데이터를 불러오는 중입니다." : "해당 카테고리 업무가 없습니다."}
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
