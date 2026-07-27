import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Check, CheckCircle2, Clock, Layers, MessageSquare, Plus, RefreshCw, Search } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { PriorityBadge } from "../../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../../board/components/TaskStatusPill";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { fetchDashboardTasks } from "../../libs/utils/dashboardApi";
import {
  daysSince,
  daysUntilDue,
  isDangerDelayRisk,
  normalizePriority,
  normalizeTaskStatus,
  sourceLabel,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";
import type { DashboardTaskDto } from "../../libs/types/dashboard";
import type { Priority, TaskStatus } from "../../../board/libs/types/task";
import { TaskDetailPopup } from "../../components/TaskDetailPopup";
import { TaskStatusPopup } from "../../components/TaskStatusPopup";
import { AddTaskModal } from "../../../board/components/AddTaskModal";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";

/** 업무 데이터 변경(다른 사용자의 생성/수정 등)을 자동으로 반영하기 위한 목록 새로고침 주기. */
const AUTO_REFRESH_INTERVAL_MS = 15000;

const DELAY_RISK_BADGE_CLASS: Record<string, string> = {
  위험: "bg-red-100 text-red-700",
  주의: "bg-amber-100 text-amber-700",
  정상: "bg-emerald-100 text-emerald-700",
};

const STATUS_FILTERS: Array<{ label: string; value: TaskStatus | "all" }> = [
  { label: "전체", value: "all" },
  { label: "대기", value: "todo" },
  { label: "진행중", value: "inprogress" },
  { label: "완료", value: "done" },
  { label: "블로커", value: "blocked" },
];

/** 검색창이 '상태'/'우선순위' 컬럼에 표시되는 라벨 텍스트로도 매칭되도록 쓰는 맵. */
const STATUS_SEARCH_LABEL: Record<TaskStatus, string> = { done: "완료", inprogress: "진행중", todo: "대기", blocked: "블로커" };
const STATUS_SORT_ORDER: Record<TaskStatus, number> = { todo: 0, inprogress: 1, blocked: 2, done: 3 };

/** 이 페이지(전체 업무 관리)의 마감일 컬럼만 "yy.mm.dd" 형식으로 표시한다. */
function formatDueDateYyMmDd(dueDate: string | null | undefined): string {
  if (!dueDate) return "미정";
  const [year, month, day] = dueDate.slice(0, 10).split("-");
  return year && month && day ? `${year.slice(2)}.${month}.${day}` : dueDate;
}

type SearchCategory = "all" | "id" | "title" | "category" | "assignee" | "status" | "priority" | "risk" | "dueDate" | "source";

const SEARCH_CATEGORY_OPTIONS: Array<{ value: SearchCategory; label: string }> = [
  { value: "all", label: "전체" },
  { value: "id", label: "ID" },
  { value: "title", label: "업무명" },
  { value: "category", label: "카테고리" },
  { value: "assignee", label: "담당자" },
  { value: "status", label: "상태" },
  { value: "priority", label: "우선순위" },
  { value: "risk", label: "지연 위험도" },
  { value: "dueDate", label: "마감일" },
  { value: "source", label: "출처" },
];
const PRIORITY_SEARCH_LABEL: Record<Priority, string> = { high: "높음", medium: "중간", low: "낮음" };

export function AllTasksPage() {
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const { user, currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: tasks, loading, error, refetch } = useDashboardTasks(currentProjectId);
  const { data: progress, loading: progressLoading } = useDashboardProgress(currentProjectId);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchCategory, setSearchCategory] = useState<SearchCategory>("all");
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const [sortBy, setSortBy] = useState("id");
  const [selected, setSelected] = useState<string[]>([]);
  const [showMeetingPendingOnly, setShowMeetingPendingOnly] = useState(false);
  const [meetingBannerDismissed, setMeetingBannerDismissed] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{ task: DashboardTaskDto; focusComments: boolean } | null>(null);
  const [statusTarget, setStatusTarget] = useState<DashboardTaskDto | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
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

  // 목록 화면을 깜빡이며 새로고침하지 않도록, 주기적으로 조용히 최신 데이터를 가져와
  // 실제로 달라졌을 때만 refetch()로 화면을 갱신한다.
  const tasksSignatureRef = useRef<string>("");
  useEffect(() => {
    tasksSignatureRef.current = tasks.map(t => `${t.id}:${t.status}:${t.updatedAt}`).join("|");
  }, [tasks]);

  useEffect(() => {
    if (currentProjectId == null) return;
    const interval = setInterval(() => {
      fetchDashboardTasks(currentProjectId)
        .then(fresh => {
          const freshSignature = fresh.map(t => `${t.id}:${t.status}:${t.updatedAt}`).join("|");
          if (freshSignature !== tasksSignatureRef.current) refetch();
        })
        .catch(() => {});
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [currentProjectId, refetch]);

  const isMeetingGenerated = (task: DashboardTaskDto) => (task.sourceType ?? "").toUpperCase().includes("MEETING");
  const meetingPendingTasks = useMemo(
    () => tasks.filter(task => isMeetingGenerated(task) && normalizeTaskStatus(task.status) === "todo"),
    [tasks]
  );

  const delayRiskByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    (progress?.delayRisks ?? []).forEach(risk => map.set(risk.taskId, risk.result));
    return map;
  }, [progress]);

  const delayRiskLabel = (taskId: string, status: TaskStatus): string | null => {
    if (status === "done") return null; // 완료된 업무는 지연 위험도 분석 대상이 아님
    const result = delayRiskByTaskId.get(taskId);
    if (result) return result;
    return progress?.hasPredictions ? "정상" : null;
  };

  /** 검색어 카테고리별로 실제 화면에 보이는 해당 컬럼 값만 비교한다 ('전체'면 전 컬럼, '액션' 제외). */
  const searchFieldValue = (task: DashboardTaskDto, category: SearchCategory): string => {
    const status = normalizeTaskStatus(task.status);
    switch (category) {
      case "id": return task.id.toLowerCase();
      case "title": return task.title.toLowerCase();
      case "category": return (task.category ?? "").toLowerCase();
      case "assignee": return (task.assigneeName ?? "").toLowerCase();
      case "status": return STATUS_SEARCH_LABEL[status].toLowerCase();
      case "priority": return PRIORITY_SEARCH_LABEL[normalizePriority(task.priority)].toLowerCase();
      case "risk": return (delayRiskLabel(task.id, status) ?? "").toLowerCase();
      case "dueDate": return formatDueDateYyMmDd(task.dueDate).toLowerCase();
      case "source": return sourceLabel(task.sourceType).toLowerCase();
      default: return "";
    }
  };

  const matchesSearchQuery = (task: DashboardTaskDto, query: string, category: SearchCategory): boolean => {
    if (!query) return true;
    if (category !== "all") return searchFieldValue(task, category).includes(query);
    return SEARCH_CATEGORY_OPTIONS.some(option => option.value !== "all" && searchFieldValue(task, option.value).includes(query));
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = tasks.filter(task => {
      const matchesStatus = filterStatus === "all" || normalizeTaskStatus(task.status) === filterStatus;
      const matchesQuery = matchesSearchQuery(task, query, searchCategory);
      const matchesMeetingPending = !showMeetingPendingOnly || (isMeetingGenerated(task) && normalizeTaskStatus(task.status) === "todo");
      return matchesStatus && matchesQuery && matchesMeetingPending;
    });
    return [...rows].sort((a, b) => {
      if (sortBy === "id") return (Number(a.id) || 0) - (Number(b.id) || 0);
      if (sortBy === "status") return STATUS_SORT_ORDER[normalizeTaskStatus(a.status)] - STATUS_SORT_ORDER[normalizeTaskStatus(b.status)];
      if (sortBy === "assignee") return (a.assigneeName ?? "").localeCompare(b.assigneeName ?? "");
      if (sortBy === "category") return (a.category ?? "").localeCompare(b.category ?? "");
      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    });
  }, [filterStatus, search, searchCategory, sortBy, showMeetingPendingOnly, tasks, delayRiskByTaskId]);

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

  const counts = {
    total: tasks.length,
    done: tasks.filter(t => normalizeTaskStatus(t.status) === "done").length,
    inProgress: tasks.filter(t => normalizeTaskStatus(t.status) === "inprogress").length,
    blocked: tasks.filter(t => normalizeTaskStatus(t.status) === "blocked").length,
  };

  const donePct = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
  const allSelected = filtered.length > 0 && filtered.every(t => selected.includes(t.id));
  const toggleAll = () => setSelected(allSelected ? [] : filtered.map(t => t.id));
  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">전체 업무 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">프로젝트의 모든 To-Do를 확인하고 팀원에게 배정·관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "새로고침 중..." : "새로고침"}
          </button>
          {isLeader && (
            <button onClick={() => setShowAddTask(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ background: "var(--primary)" }}>
              <Plus className="w-3.5 h-3.5" /> 업무 추가
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-4 gap-3">
        <DetailStatCard label="전체 업무" value={loading ? "..." : counts.total} sub="프로젝트 전체" color="#3B5BDB" icon={Layers} />
        <DetailStatCard label="완료" value={loading ? "..." : counts.done} sub={loading ? "불러오는 중" : `완료율 ${donePct}%`} color="#10B981" icon={CheckCircle2} />
        <DetailStatCard label="진행중" value={loading ? "..." : counts.inProgress} sub="활성 업무" color="#3B5BDB" icon={Clock} />
        <DetailStatCard label="블로커" value={loading ? "..." : counts.blocked} sub="즉시 해결 필요" color="#EF4444" icon={AlertTriangle} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={aiInsightPrompt}
        ready={aiInsightReady && longestStalledDangerTask != null}
        fallbackText={aiInsightFallback}
        formatAnswer={answer => `${aiInsightFallback} ${answer}`}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={searchCategory}
          onChange={e => setSearchCategory(e.target.value as SearchCategory)}
          className="text-xs border border-border rounded-lg px-2 py-2 bg-card text-foreground outline-none cursor-pointer"
        >
          {SEARCH_CATEGORY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <form className="relative" onSubmit={e => { e.preventDefault(); setSearch(searchDraft); }}>
          <button type="submit" aria-label="검색" className="absolute left-3 top-1/2 -translate-y-1/2 cursor-pointer">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <input value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder="검색어를 입력하세요."
            className="pl-9 pr-4 py-2 text-xs rounded-lg border border-border bg-card outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all w-56" />
        </form>
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(filter => (
            <button key={filter.value} onClick={() => setFilterStatus(filter.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterStatus === filter.value ? "bg-blue-600 text-white" : "bg-card border border-border text-muted-foreground hover:border-slate-300"}`}>
              {filter.label}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="ml-auto text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground outline-none cursor-pointer">
          <option value="id">ID순</option>
          <option value="dueDate">마감일순</option>
          <option value="status">상태순</option>
          <option value="assignee">담당자순</option>
          <option value="category">카테고리순</option>
        </select>
        {selected.length > 0 && (
          <div className="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-600">
            {selected.length}개 선택됨
          </div>
        )}
      </div>

      {!meetingBannerDismissed && meetingPendingTasks.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-800 flex-1">회의록 AI가 생성한 업무 {meetingPendingTasks.length}개가 대기중입니다.</span>
          <button onClick={() => setShowMeetingPendingOnly(true)} className="text-xs font-semibold text-amber-700 underline hover:text-amber-800">승인 검토</button>
          <button onClick={() => { setMeetingBannerDismissed(true); setShowMeetingPendingOnly(false); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">반려</button>
        </div>
      )}
      {showMeetingPendingOnly && (
        <button onClick={() => setShowMeetingPendingOnly(false)} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">
          ← 회의록 AI 대기 업무 필터 해제
        </button>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="pl-4 pr-2 py-3">
                <button onClick={toggleAll} className={`w-4 h-4 rounded border flex items-center justify-center ${allSelected ? "border-blue-500 bg-blue-500" : "border-border hover:border-blue-400"}`}>
                  {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
                </button>
              </th>
              {["ID", "업무명", "카테고리", "담당자", "상태", "우선순위", "지연 위험도", "마감일", "출처", "액션"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!loading && filtered.map((task, index) => {
              const member = taskAssignee(task, index);
              const status = normalizeTaskStatus(task.status);
              const priority = normalizePriority(task.priority);
              const isSelected = selected.includes(task.id);
              const daysLeft = daysUntilDue(task.dueDate);
              const isDueSoon = status !== "done" && daysLeft != null && daysLeft <= 3;
              return (
                <tr key={task.id} className={`hover:bg-muted/30 transition-colors ${isSelected ? "bg-blue-50/40" : ""}`}>
                  <td className="pl-4 pr-2 py-3">
                    <button onClick={() => toggle(task.id)} className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "border-blue-500 bg-blue-500" : "border-border hover:border-blue-400"}`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{task.id}</td>
                  <td className="px-3 py-3 max-w-[240px]">
                    <div onClick={() => setDetailTarget({ task, focusComments: false })} className="text-xs font-medium text-foreground truncate cursor-pointer">{task.title}</div>
                    {isMeetingGenerated(task) && status === "todo" && (
                      <div className="text-[10px] text-purple-600 mt-0.5">AI 생성 · 승인 대기</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 whitespace-nowrap">{task.category ?? "미분류"}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: member.color }}>{member.initials}</div>
                      <span className="text-xs text-foreground whitespace-nowrap">{member.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3"><TaskStatusPill status={status} /></td>
                  <td className="px-3 py-3"><PriorityBadge priority={priority} /></td>
                  <td className="px-3 py-3">
                    {(() => {
                      const risk = delayRiskLabel(task.id, status);
                      return risk ? (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${DELAY_RISK_BADGE_CLASS[risk] ?? "bg-slate-100 text-slate-500"}`}>
                          {risk}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-medium ${isDueSoon ? "text-amber-600" : "text-muted-foreground"}`}>
                      {formatDueDateYyMmDd(task.dueDate)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 whitespace-nowrap">{sourceLabel(task.sourceType)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button onClick={() => setDetailTarget({ task, focusComments: false })} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">상세</button>
                      <button onClick={() => setStatusTarget(task)} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">상태 변경</button>
                      <button onClick={() => setDetailTarget({ task, focusComments: true })} className="p-1 rounded hover:bg-muted transition-colors">
                        <MessageSquare className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(loading || filtered.length === 0) && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {loading ? "데이터를 불러오는 중입니다" : "표시할 업무가 없습니다."}
          </div>
        )}
        <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{filtered.length}개 업무</span>
          <span className="text-xs text-muted-foreground">Supabase 실시간 조회 결과</span>
        </div>
      </div>

      {detailTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={detailTarget.task}
          projectId={currentProjectId}
          focusComments={detailTarget.focusComments}
          onClose={() => setDetailTarget(null)}
        />
      )}
      {statusTarget && currentProjectId != null && (
        <TaskStatusPopup
          task={statusTarget}
          tasks={tasks}
          projectId={currentProjectId}
          onClose={() => setStatusTarget(null)}
          onChanged={() => { setStatusTarget(null); refetch(); }}
        />
      )}
      <AddTaskModal
        open={showAddTask}
        initialStatus="todo"
        projectMembers={projectMembers}
        onClose={() => { setShowAddTask(false); refetch(); }}
        onCreated={() => refetch()}
      />
    </div>
  );
}
