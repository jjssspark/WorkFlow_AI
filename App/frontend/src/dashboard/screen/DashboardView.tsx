{/* <전체 대시보드 페이지 목록 (9개)>
1. 대시보드 페이지(DashboardView.tsx)
2. 전체 업무 관리 페이지(AllTasksPage.tsx)
3. 진행률 분석 페이지(ProgressPage.tsx)
4. 블로커 관리 페이지(BlockersPage.tsx)
5. 진행 중 업무 모니터링 페이지(InProgressPage.tsx)
6. 전체 진행률 페이지(DashProgressPage.tsx)
7. 마감 임박 업무 페이지(UrgentTasksPage.tsx)
8. 팀원별 업무량 페이지(WorkloadPage.tsx)
9. 최근 활동 페이지(ActivityPage.tsx) */}


// ===================================================
// 대시보드 페이지(DashboardView.tsx)
import { useEffect, useState } from "react";
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
  RefreshCw,
  Sparkles,
  TrendingUp,
  Upload,
  X,
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
import { daysUntilDue, formatDashboardDueDate, normalizePriority, normalizeTaskStatus } from "../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay } from "../libs/utils/memberDisplay";
import { openAIAssistant } from "../../ai/libs/utils/openAIAssistant";
import { ProgressFrequencyChart } from "../components/ProgressFrequencyChart";
import { AddTaskModal } from "../../board/components/AddTaskModal";
import { MeetingUploadModal } from "../../meetings/components/MeetingUploadModal";
import { TaskDetailPopup } from "../components/TaskDetailPopup";
import { TaskStatusPill } from "../../board/components/TaskStatusPill";
import { PriorityBadge } from "../../board/components/PriorityBadge";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import type { DashboardTaskDto } from "../libs/types/dashboard";

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
  const { user, currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: summary, loading: summaryLoadingRaw, error: summaryError, refetch: refetchSummary } = useDashboardSummary(currentProjectId);
  const { data: progress, loading: progressLoadingRaw, error: progressError, refetch: refetchProgress } = useDashboardProgress(currentProjectId);
  const { data: tasks, loading: tasksLoadingRaw, refetch: refetchTasks } = useDashboardTasks(currentProjectId);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  // 새로고침 버튼을 누른 동안은 각 데이터 영역이 "데이터를 불러오는 중입니다"로 보이도록,
  // 개별 훅의 loading 상태에 pageRefreshing을 합쳐서 쓴다.
  const summaryLoading = summaryLoadingRaw || pageRefreshing;
  const progressLoading = progressLoadingRaw || pageRefreshing;
  const tasksLoading = tasksLoadingRaw || pageRefreshing;
  const refreshAll = async () => {
    setPageRefreshing(true);
    await Promise.all([refetchSummary(), refetchProgress(), refetchTasks()]);
    setPageRefreshing(false);
  };
  const [showAddTask, setShowAddTask] = useState(false);
  const [showUploadMeeting, setShowUploadMeeting] = useState(false);
  const [showMyTasks, setShowMyTasks] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DashboardTaskDto | null>(null);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);

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

  const myTasks = user == null ? [] : tasks.filter(task => task.assigneeId === String(user.id));

  const quickActions = [
    ...(isLeader
      ? [{ label: "업무 추가", icon: Plus, color: "#3B5BDB", onClick: () => setShowAddTask(true) }]
      : [{ label: "내업무 조회", icon: Plus, color: "#3B5BDB", onClick: () => setShowMyTasks(true) }]),
    { label: "회의록 업로드", icon: Upload, color: "#7048E8", onClick: () => setShowUploadMeeting(true) },
    ...(deliverablesActive ? [{ label: "산출물", icon: Package, color: "#0F766E", onClick: () => navigate("/deliverables") }] : []),
    { label: "AI Assistant", icon: Sparkles, color: "#F59E0B", onClick: () => openAIAssistant() },
    { label: "업무 보드", icon: Columns3, color: "#0EA5E9", onClick: () => navigate("/board") },
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
      <div className="flex items-center justify-end">
        <button
          onClick={refreshAll}
          disabled={pageRefreshing}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${pageRefreshing ? "animate-spin" : ""}`} />{pageRefreshing ? "새로고침 중..." : "새로고침"}
        </button>
      </div>

      {(summaryError || progressError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          데이터를 불러오지 못했습니다. {summaryError ?? progressError}
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
              // 사용자 ID를 색상 키로 써서 이름이나 목록 순서가 바뀌어도 같은 색을 유지한다.
              // 구버전 응답에는 ID가 없을 수 있으므로 이름, 미배정 고정 키 순서로 대체한다.
              const assigneeColorKey = task.assigneeId
                ?? (task.assigneeName ? `name:${task.assigneeName}` : "unassigned");
              const member = resolveMemberDisplay(task.assigneeName, index, assigneeColorKey);
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

      <AddTaskModal
        open={showAddTask}
        initialStatus="todo"
        projectMembers={projectMembers}
        onClose={() => setShowAddTask(false)}
        onCreated={() => { refetchSummary(); refetchProgress(); refetchTasks(); }}
      />

      {showUploadMeeting && (
        <MeetingUploadModal
          projectId={String(currentProjectId)}
          projectMembers={projectMembers}
          onClose={() => setShowUploadMeeting(false)}
          onUploaded={(meetingId, title, uploadedAt) => {
            setShowUploadMeeting(false);
            navigate(`/meetings?resume=${encodeURIComponent(meetingId)}&title=${encodeURIComponent(title)}&uploadedAt=${encodeURIComponent(uploadedAt)}`);
          }}
        />
      )}

      {showMyTasks && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowMyTasks(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
              <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
                <span className="text-sm font-semibold text-foreground">내 업무 목록</span>
                <button onClick={() => setShowMyTasks(false)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
              <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                <span className="w-12 shrink-0">ID</span>
                <span className="flex-1">업무명</span>
                <span className="shrink-0">상태</span>
                <span className="shrink-0">우선순위</span>
                <span className="w-12 text-right shrink-0">마감일</span>
                <span className="w-8 shrink-0" />
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border">
                {tasksLoading ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">데이터를 불러오는 중입니다.</div>
                ) : myTasks.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">배정된 업무가 없습니다.</div>
                ) : myTasks.map(task => (
                  <div key={task.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                    <span className="font-mono text-[10px] text-muted-foreground w-12">{task.id}</span>
                    <span onClick={() => setDetailTarget(task)} className="flex-1 text-xs font-medium text-foreground truncate cursor-pointer hover:text-blue-700">{task.title}</span>
                    <TaskStatusPill status={normalizeTaskStatus(task.status)} />
                    <PriorityBadge priority={normalizePriority(task.priority)} />
                    <span className="text-xs text-muted-foreground w-12 text-right">{formatDashboardDueDate(task.dueDate)}</span>
                    <button onClick={() => setDetailTarget(task)} className="text-[11px] font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap">상세</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {detailTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={detailTarget}
          projectId={currentProjectId}
          onClose={() => setDetailTarget(null)}
          isLeader={isLeader}
          projectMembers={projectMembers}
          onUpdated={() => refreshAll()}
        />
      )}
    </div>
  );
}
