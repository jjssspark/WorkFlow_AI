import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, Flag, GripVertical, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../../global/hooks/useAuth";
import type { RoadmapMilestone, RoadmapResponse, RoadmapTask, RoadmapZoom } from "../libs/types/roadmap";
import { createMilestone, createRoadmapTask, fetchRoadmap, moveRoadmapTask } from "../libs/utils/roadmapApi";
import { barStyle, intervalOverlapsRange, isDateWithinRange, positionPercent, resolveTimelineRange, timelineSegments } from "../libs/utils/timeline";

const STATUS_LABELS: Record<string, string> = {
  todo: "할 일",
  inprogress: "진행 중",
  blocked: "막힘",
  done: "완료",
};

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-slate-300 text-slate-700",
  inprogress: "bg-blue-500 text-white",
  blocked: "bg-red-400 text-white",
  done: "bg-emerald-500 text-white",
};

function formatDate(value: string | null): string {
  if (!value) return "미정";
  const [, month, day] = value.split("-");
  return month && day ? `${Number(month)}.${Number(day)}` : value;
}

function formatFullDate(value: string | null): string {
  if (!value) return "미정";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${Number(month)}.${Number(day)}` : value;
}

function taskMatches(task: RoadmapTask, status: string, query: string): boolean {
  return (status === "all" || task.status === status)
    && (query === "" || task.title.toLowerCase().includes(query.toLowerCase()) || (task.assigneeName ?? "").includes(query));
}

function recalculate(milestone: RoadmapMilestone): RoadmapMilestone {
  const doneCount = milestone.tasks.filter((task) => task.status === "done").length;
  return {
    ...milestone,
    taskCount: milestone.tasks.length,
    doneCount,
    progressPercent: milestone.tasks.length === 0 ? 0 : Math.round(doneCount * 100 / milestone.tasks.length),
  };
}

export function RoadmapView() {
  const navigate = useNavigate();
  const { currentProjectId, currentProject } = useAuth();
  const projectId = currentProjectId ?? 1;
  const canManageMilestones = currentProject?.role === "팀장";
  const [roadmap, setRoadmap] = useState<RoadmapResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<RoadmapZoom>("month");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [quickAddId, setQuickAddId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: "", startDate: "", dueDate: "" });
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<RoadmapTask | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  const loadRoadmap = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const result = await fetchRoadmap(projectId);
      setRoadmap(result);
      setExpanded(new Set(result.milestones.map((milestone) => milestone.id)));
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로드맵을 불러오지 못했습니다.");
      setLoadState("error");
    }
  }, [projectId]);

  useEffect(() => { void loadRoadmap(); }, [loadRoadmap]);

  const range = useMemo(() => roadmap ? resolveTimelineRange(roadmap) : null, [roadmap]);
  const segments = useMemo(() => range ? timelineSegments(range, zoom) : [], [range, zoom]);
  const todayLeft = useMemo(() => {
    if (!range) return null;
    const today = new Date().toISOString().slice(0, 10);
    return isDateWithinRange(today, range) ? positionPercent(today, range) : null;
  }, [range]);
  const hasProjectRange = Boolean(roadmap?.project.startDate && roadmap?.project.deadline);
  const canCreateMilestones = canManageMilestones && hasProjectRange;

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitMilestone = async (event: FormEvent) => {
    event.preventDefault();
    if (!milestoneForm.title.trim() || saving || !roadmap) return;
    setSaving(true);
    setError("");
    try {
      const created = await createMilestone(projectId, {
        title: milestoneForm.title.trim(),
        startDate: milestoneForm.startDate || null,
        dueDate: milestoneForm.dueDate || null,
      });
      setRoadmap({ ...roadmap, milestones: [...roadmap.milestones, created] });
      setExpanded((current) => new Set([...current, created.id]));
      setMilestoneForm({ title: "", startDate: "", dueDate: "" });
      setShowMilestoneForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "마일스톤을 추가하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const submitQuickTask = async (event: FormEvent, milestoneId: string) => {
    event.preventDefault();
    if (!quickTitle.trim() || saving || !roadmap) return;
    setSaving(true);
    setError("");
    try {
      const created = await createRoadmapTask(projectId, milestoneId, { title: quickTitle.trim() });
      setRoadmap({
        ...roadmap,
        milestones: roadmap.milestones.map((milestone) => milestone.id === milestoneId
          ? recalculate({ ...milestone, tasks: [...milestone.tasks, created] })
          : milestone),
      });
      setQuickTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업무를 추가하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const updateTaskMilestone = (source: RoadmapResponse, taskId: string, targetId: string | null): RoadmapResponse => {
    let moved: RoadmapTask | undefined;
    const milestonesWithout = source.milestones.map((milestone) => {
      const found = milestone.tasks.find((task) => task.id === taskId);
      if (found) moved = { ...found, milestoneId: targetId };
      return recalculate({ ...milestone, tasks: milestone.tasks.filter((task) => task.id !== taskId) });
    });
    const unassignedFound = source.unassignedTasks.find((task) => task.id === taskId);
    if (unassignedFound) moved = { ...unassignedFound, milestoneId: targetId };
    if (!moved) return source;
    if (targetId === null) {
      return { ...source, milestones: milestonesWithout, unassignedTasks: [...source.unassignedTasks.filter((task) => task.id !== taskId), moved] };
    }
    return {
      ...source,
      unassignedTasks: source.unassignedTasks.filter((task) => task.id !== taskId),
      milestones: milestonesWithout.map((milestone) => milestone.id === targetId
        ? recalculate({ ...milestone, tasks: [...milestone.tasks, moved!] })
        : milestone),
    };
  };

  const dropTask = async (targetMilestoneId: string | null) => {
    if (!dragTaskId || !roadmap || !canManageMilestones) return;
    const previous = roadmap;
    setRoadmap(updateTaskMilestone(roadmap, dragTaskId, targetMilestoneId));
    setDropTarget(null);
    try {
      await moveRoadmapTask(projectId, dragTaskId, targetMilestoneId);
    } catch (cause) {
      setRoadmap(previous);
      setError(cause instanceof Error ? cause.message : "업무 단계를 이동하지 못했습니다.");
    } finally {
      setDragTaskId(null);
    }
  };

  const dragOver = (event: DragEvent, target: string) => {
    if (!canManageMilestones) return;
    event.preventDefault();
    setDropTarget(target);
  };

  if (loadState === "loading") {
    return <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="w-4 h-4 animate-spin" />로드맵을 불러오는 중...</div>;
  }
  if (loadState === "error" || !roadmap || !range) {
    return <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><AlertTriangle className="w-5 h-5" /><span>{error || "로드맵을 불러오지 못했습니다."}</span><button onClick={() => void loadRoadmap()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground flex items-center gap-2"><RefreshCw className="w-4 h-4" />다시 시도</button></div>;
  }

  const filteredMilestones = roadmap.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.filter((task) => taskMatches(task, statusFilter, query)),
  }));
  const filteredUnassigned = roadmap.unassignedTasks.filter((task) => taskMatches(task, statusFilter, query));

  const TaskRow = ({ task }: { task: RoadmapTask }) => {
    const style = barStyle(task.startDate, task.dueDate, range);
    const hasSchedule = Boolean(task.startDate || task.dueDate);
    const overlapsVisibleRange = intervalOverlapsRange(task.startDate, task.dueDate, range);
    const dueOnly = !task.startDate && Boolean(task.dueDate);
    const dueLeft = dueOnly ? positionPercent(task.dueDate, range) : null;
    return (
      <button
        type="button"
        draggable={canManageMilestones}
        onDragStart={() => setDragTaskId(task.id)}
        onDragEnd={() => { setDragTaskId(null); setDropTarget(null); }}
        onClick={() => setSelectedTask(task)}
        className={`w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[52px] border-b border-border text-left hover:bg-accent/40 transition-colors ${selectedTask?.id === task.id ? "bg-accent/60" : ""}`}
      >
        <span className="px-4 py-2 flex items-center gap-2 border-r border-border min-w-0">
          {canManageMilestones && <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0 cursor-grab" />}
          <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium truncate">{task.title}</span>
            <span className="block text-[10px] text-muted-foreground truncate">{task.assigneeName ?? "미배정"} · {STATUS_LABELS[task.status] ?? task.status} · {formatDate(task.startDate)}–{formatDate(task.dueDate)}</span>
          </span>
        </span>
        <span className="relative min-w-0 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(25%-1px),var(--border)_calc(25%-1px),var(--border)_25%)]">
          {!hasSchedule && <span className="absolute left-3 top-4 text-[10px] text-muted-foreground">일정 미정</span>}
          {hasSchedule && !overlapsVisibleRange && <span className="absolute left-3 top-4 text-[10px] text-muted-foreground">표시 범위 밖 · {formatDate(task.startDate ?? task.dueDate)}</span>}
          {overlapsVisibleRange && dueOnly && dueLeft !== null && (
            <span className="absolute top-2.5 -translate-x-1/2 flex flex-col items-center" style={{ left: `${dueLeft}%` }}>
              <span className={`w-3 h-3 rotate-45 rounded-[2px] ${STATUS_COLORS[task.status] ?? STATUS_COLORS.todo}`} />
              <span className="mt-1 whitespace-nowrap text-[9px] font-medium text-muted-foreground">마감 {formatDate(task.dueDate)}</span>
            </span>
          )}
          {overlapsVisibleRange && !dueOnly && style && <span className={`absolute top-3.5 h-6 rounded-md px-2 flex items-center text-[10px] font-semibold overflow-hidden whitespace-nowrap ${STATUS_COLORS[task.status] ?? STATUS_COLORS.todo}`} style={style}>{task.title}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[10px] text-muted-foreground">{roadmap.project.title} / 계획 관리</div><h1 className="text-xl font-semibold mt-1">팀 로드맵</h1></div>
          <div className="flex items-center gap-2">
            <button onClick={() => setZoom("month")} className={`px-3 py-1.5 rounded-lg text-xs border ${zoom === "month" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>월</button>
            <button onClick={() => setZoom("week")} className={`px-3 py-1.5 rounded-lg text-xs border ${zoom === "week" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>주</button>
            {canManageMilestones && <button disabled={!canCreateMilestones} title={!hasProjectRange ? "프로젝트 시작일과 종료일을 먼저 설정하세요." : undefined} onClick={() => setShowMilestoneForm(true)} className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Flag className="w-3.5 h-3.5" />새 단계</button>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-muted-foreground">검색<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업무명 또는 담당자" className="block mt-1 w-48 px-3 py-2 rounded-lg border border-border bg-input-background text-xs text-foreground outline-none" /></label>
          <label className="text-[10px] text-muted-foreground">상태<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="block mt-1 px-3 py-2 rounded-lg border border-border bg-input-background text-xs text-foreground"><option value="all">전체</option><option value="todo">할 일</option><option value="inprogress">진행 중</option><option value="blocked">막힘</option><option value="done">완료</option></select></label>
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />프로젝트 {formatFullDate(roadmap.project.startDate)}–{formatFullDate(roadmap.project.deadline)}</span>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        {!hasProjectRange && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>프로젝트 시작일과 종료일이 없어 현재 시점부터 3개월을 임시로 표시합니다.</span>
            {canManageMilestones && <button type="button" onClick={() => navigate("/mypage#project-settings")} className="ml-auto font-semibold text-amber-900 underline underline-offset-2">프로젝트 일정 설정</button>}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        <div className="w-full min-w-[840px] relative">
          <div className="sticky top-0 z-20 w-full grid grid-cols-[300px_minmax(520px,1fr)] h-11 bg-muted border-b border-border">
            <div className="px-4 flex items-center border-r border-border text-xs font-semibold">단계 / 업무</div>
            <div className="relative">
              {segments.map((segment) => <div key={segment.key} className="absolute inset-y-0 border-r border-border flex items-center justify-center text-[10px] text-muted-foreground" style={{ left: `${segment.left}%`, width: `${segment.width}%` }}>{segment.label}</div>)}
            </div>
          </div>

          {filteredMilestones.map((milestone, index) => {
            const open = expanded.has(milestone.id);
            const milestoneStyle = barStyle(milestone.startDate, milestone.dueDate, range);
            const targetKey = milestone.id;
            return (
              <div key={milestone.id} onDragOver={(event) => dragOver(event, targetKey)} onDrop={() => void dropTask(milestone.id)} onDragLeave={() => setDropTarget(null)} className={dropTarget === targetKey ? "ring-2 ring-inset ring-primary" : ""}>
                <div className="grid grid-cols-[300px_minmax(520px,1fr)] min-h-[58px] border-b border-border bg-muted/50">
                  <button onClick={() => toggleExpanded(milestone.id)} className="px-4 py-2 flex items-center gap-2 border-r border-border text-left min-w-0">
                    {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0">{index + 1}단계</span>
                    <span className="min-w-0"><span className="block text-xs font-semibold truncate">{milestone.title}</span><span className="block text-[10px] text-muted-foreground">{formatDate(milestone.startDate)}–{formatDate(milestone.dueDate)} · {milestone.progressPercent}%</span></span>
                  </button>
                  <div className="relative bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(25%-1px),var(--border)_calc(25%-1px),var(--border)_25%)]">
                    {milestoneStyle && <span className="absolute top-5 h-3 rounded-full bg-muted overflow-hidden" style={milestoneStyle}><span className="block h-full bg-primary" style={{ width: `${milestone.progressPercent}%` }} /></span>}
                  </div>
                </div>
                {open && milestone.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
                {open && quickAddId === milestone.id && (
                  <form onSubmit={(event) => void submitQuickTask(event, milestone.id)} className="grid grid-cols-[300px_minmax(520px,1fr)] min-h-[50px] border-b border-border bg-accent/20">
                    <div className="px-7 py-2 border-r border-border flex gap-2"><input autoFocus value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="업무명 입력 후 Enter" maxLength={200} className="min-w-0 flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none" /><button disabled={saving || !quickTitle.trim()} className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50">추가</button></div>
                    <div className="px-4 flex items-center text-[10px] text-muted-foreground">{milestone.title}에 자동 연결 · 기본 일정 {formatDate(milestone.startDate)}–{formatDate(milestone.dueDate)}</div>
                  </form>
                )}
                {open && quickAddId !== milestone.id && (
                  <button onClick={() => { setQuickAddId(milestone.id); setQuickTitle(""); }} className="w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[40px] border-b border-border text-left hover:bg-accent/30">
                    <span className="px-8 border-r border-border flex items-center gap-1.5 text-xs text-primary"><Plus className="w-3.5 h-3.5" />업무 바로 추가</span><span />
                  </button>
                )}
              </div>
            );
          })}

          {(filteredUnassigned.length > 0 || roadmap.unassignedTasks.length === 0) && (
            <div onDragOver={(event) => dragOver(event, "unassigned")} onDrop={() => void dropTask(null)} className={dropTarget === "unassigned" ? "ring-2 ring-inset ring-primary" : ""}>
              <button type="button" onClick={() => setUnassignedOpen((open) => !open)} className="w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[48px] border-b border-border bg-muted/40 text-left">
                <span className="px-4 border-r border-border flex items-center gap-2 text-xs font-semibold">
                  {unassignedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <AlertTriangle className="w-4 h-4 text-amber-500" />단계 미지정
                  <span className="text-muted-foreground font-normal">{roadmap.unassignedTasks.length}</span>
                </span>
                <span className="px-4 flex items-center text-[10px] text-muted-foreground">클릭해서 업무 목록 {unassignedOpen ? "접기" : "펼치기"}</span>
              </button>
              {unassignedOpen && filteredUnassigned.map((task) => <TaskRow key={task.id} task={task} />)}
            </div>
          )}

          {showMilestoneForm && canCreateMilestones ? (
            <form onSubmit={(event) => void submitMilestone(event)} className="grid grid-cols-[300px_minmax(520px,1fr)] border-b border-border bg-accent/20">
              <div className="p-3 border-r border-border space-y-2"><input autoFocus value={milestoneForm.title} onChange={(event) => setMilestoneForm({ ...milestoneForm, title: event.target.value })} placeholder="새 단계 이름" maxLength={200} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs" /><div className="grid grid-cols-2 gap-2"><input aria-label="시작일" type="date" min={roadmap.project.startDate ?? undefined} max={milestoneForm.dueDate || roadmap.project.deadline || undefined} value={milestoneForm.startDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, startDate: event.target.value })} className="min-w-0 px-2 py-1.5 rounded-lg border border-border bg-background text-[10px]" /><input aria-label="마감일" type="date" min={milestoneForm.startDate || roadmap.project.startDate || undefined} max={roadmap.project.deadline ?? undefined} value={milestoneForm.dueDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, dueDate: event.target.value })} className="min-w-0 px-2 py-1.5 rounded-lg border border-border bg-background text-[10px]" /></div><div className="flex gap-2"><button disabled={saving || !milestoneForm.title.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50">단계 추가</button><button type="button" onClick={() => setShowMilestoneForm(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs">취소</button></div></div><div className="px-4 flex items-center text-xs text-muted-foreground">프로젝트 기간 {formatFullDate(roadmap.project.startDate)}–{formatFullDate(roadmap.project.deadline)} 안에서 설정합니다.</div>
            </form>
          ) : canManageMilestones && (
            <button disabled={!canCreateMilestones} onClick={() => setShowMilestoneForm(true)} className="w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[48px] text-left hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"><span className="px-4 border-r border-border flex items-center gap-2 text-xs text-primary"><Flag className="w-4 h-4" />새 단계 추가</span><span className="px-4 flex items-center text-[10px] text-muted-foreground">{hasProjectRange ? "" : "프로젝트 일정을 먼저 설정하세요."}</span></button>
          )}

          {todayLeft !== null && todayLeft >= 0 && todayLeft <= 100 && <div className="absolute top-11 bottom-0 w-px bg-orange-500 pointer-events-none z-10" style={{ left: `calc(300px + (100% - 300px) * ${todayLeft / 100})` }}><span className="absolute top-1 left-1 whitespace-nowrap text-[9px] text-orange-600 bg-background px-1">오늘</span></div>}
        </div>
      </div>

      {selectedTask && <div className="shrink-0 px-6 py-2.5 border-t border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><strong>{selectedTask.title}</strong><span className="text-muted-foreground">{selectedTask.assigneeName ?? "미배정"}</span><span className="text-muted-foreground">{formatDate(selectedTask.startDate)}–{formatDate(selectedTask.dueDate)}</span><span className="px-2 py-0.5 rounded-full bg-muted">{STATUS_LABELS[selectedTask.status] ?? selectedTask.status}</span></div>}
    </div>
  );
}
