import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AlertTriangle, ArrowDownUp, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Circle, ClipboardList, Flag, GripVertical, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../../global/hooks/useAuth";
import type { ChecklistItem } from "../../board/libs/types/task";
import { fetchChecklist } from "../../board/libs/utils/checklistApi";
import type { RoadmapMilestone, RoadmapResponse, RoadmapTask, RoadmapZoom } from "../libs/types/roadmap";
import { createMilestone, deleteMilestone, fetchRoadmap, updateRoadmapTaskLayout, type MilestoneInput } from "../libs/utils/roadmapApi";
import { buildCapstoneMilestones } from "../libs/utils/roadmapRecommendations";
import { moveTasksToMilestone, reorderTasksAtTarget, sortRoadmapBySchedule } from "../libs/utils/roadmapState";
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

interface RecommendationDraft {
  id: string;
  title: string;
  startDate: string;
  dueDate: string;
}

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

export function RoadmapView() {
  const navigate = useNavigate();
  const { currentProjectId, currentProject, projectContextReady } = useAuth();
  const projectId = currentProjectId;
  const canManageMilestones = currentProject?.role === "팀장";
  const roadmapRequestId = useRef(0);
  const [roadmap, setRoadmap] = useState<RoadmapResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<RoadmapZoom>("month");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: "", startDate: "", dueDate: "" });
  const [scheduleSortEnabled, setScheduleSortEnabled] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [dragTaskIds, setDragTaskIds] = useState<string[]>([]);
  const [dragRowTarget, setDragRowTarget] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<RoadmapTask | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [creatingRecommendations, setCreatingRecommendations] = useState(false);
  const [recommendationMessage, setRecommendationMessage] = useState("");
  const [showRecommendationDialog, setShowRecommendationDialog] = useState(false);
  const [recommendationDrafts, setRecommendationDrafts] = useState<RecommendationDraft[]>([]);
  const [deletingMilestoneId, setDeletingMilestoneId] = useState<string | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [taskChecklists, setTaskChecklists] = useState<Record<string, ChecklistItem[]>>({});
  const [checklistLoadState, setChecklistLoadState] = useState<Record<string, "loading" | "ready" | "error">>({});

  const loadRoadmap = useCallback(async () => {
    if (!projectContextReady || projectId === null) return;
    const requestId = ++roadmapRequestId.current;
    setLoadState("loading");
    setError("");
    try {
      const result = await fetchRoadmap(projectId);
      if (requestId !== roadmapRequestId.current) return;
      setScheduleSortEnabled(localStorage.getItem(`roadmap:schedule-sort:${projectId}`) === "true");
      setRoadmap(result);
      setExpanded(new Set(result.milestones.map((milestone) => milestone.id)));
      setLoadState("ready");
    } catch (cause) {
      if (requestId !== roadmapRequestId.current) return;
      setError(cause instanceof Error ? cause.message : "로드맵을 불러오지 못했습니다.");
      setLoadState("error");
    }
  }, [projectContextReady, projectId]);

  useEffect(() => {
    if (!projectContextReady || projectId === null) {
      roadmapRequestId.current += 1;
      setRoadmap(null);
      setLoadState("loading");
      return;
    }
    void loadRoadmap();
    return () => {
      roadmapRequestId.current += 1;
    };
  }, [loadRoadmap, projectContextReady, projectId]);

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
    if (!milestoneForm.title.trim() || saving || !roadmap || projectId === null) return;
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

  const openProjectRecommendations = () => {
    if (!roadmap?.project.startDate || !roadmap.project.deadline) return;
    setRecommendationDrafts(
      buildCapstoneMilestones(roadmap.project.startDate, roadmap.project.deadline)
        .map((stage, index) => ({
          id: `recommended-${index}`,
          title: stage.title,
          startDate: stage.startDate ?? roadmap.project.startDate!,
          dueDate: stage.dueDate ?? roadmap.project.deadline!,
        })),
    );
    setRecommendationMessage("");
    setShowRecommendationDialog(true);
  };

  const updateRecommendationDraft = (id: string, update: Partial<RecommendationDraft>) => {
    setRecommendationDrafts((current) =>
      current.map((draft) => draft.id === id ? { ...draft, ...update } : draft));
  };

  const addRecommendationDraft = () => {
    if (!roadmap?.project.startDate || !roadmap.project.deadline) return;
    setRecommendationDrafts((current) => [...current, {
      id: `custom-${Date.now()}-${current.length}`,
      title: "",
      startDate: roadmap.project.startDate!,
      dueDate: roadmap.project.deadline!,
    }]);
  };

  const createRecommendedStages = async (event: FormEvent) => {
    event.preventDefault();
    if (!roadmap?.project.startDate || !roadmap.project.deadline || projectId === null || creatingRecommendations) return;
    const validDrafts = recommendationDrafts.filter((draft) =>
      draft.title.trim() && draft.startDate && draft.dueDate && draft.startDate <= draft.dueDate);
    if (validDrafts.length !== recommendationDrafts.length || validDrafts.length === 0) {
      setError("모든 추천 단계의 이름과 올바른 시작일·마감일을 입력해주세요.");
      return;
    }

    const existingTitles = new Set(roadmap.milestones.map((milestone) => milestone.title.trim().toLowerCase()));
    const uniqueDrafts = new Map<string, RecommendationDraft>();
    for (const draft of validDrafts) {
      const normalizedTitle = draft.title.trim().toLowerCase();
      if (!existingTitles.has(normalizedTitle) && !uniqueDrafts.has(normalizedTitle)) {
        uniqueDrafts.set(normalizedTitle, draft);
      }
    }
    const recommendations = [...uniqueDrafts.values()];
    if (recommendations.length === 0) {
      setError("입력한 단계가 이미 존재합니다. 이름을 수정하거나 새 단계를 추가해주세요.");
      return;
    }

    setCreatingRecommendations(true);
    setRecommendationMessage("");
    setError("");
    const results = await Promise.allSettled(
      recommendations.map((stage) => createMilestone(projectId, {
        title: stage.title.trim(),
        startDate: stage.startDate,
        dueDate: stage.dueDate,
      } satisfies MilestoneInput)),
    );
    const created = results
      .filter((result): result is PromiseFulfilledResult<RoadmapMilestone> => result.status === "fulfilled")
      .map((result) => result.value);
    if (created.length > 0) {
      setRoadmap((current) => current ? { ...current, milestones: [...current.milestones, ...created] } : current);
      setExpanded((current) => new Set([...current, ...created.map((milestone) => milestone.id)]));
    }
    const failedCount = results.length - created.length;
    if (failedCount > 0) {
      setError(`추천 단계 ${created.length}개를 생성했고 ${failedCount}개는 생성하지 못했습니다.`);
      setRecommendationDrafts(recommendations.filter((_, index) => results[index].status === "rejected"));
    } else {
      const skippedCount = recommendationDrafts.length - recommendations.length;
      setRecommendationMessage(`프로젝트 단계 ${created.length}개를 생성했습니다.${skippedCount > 0 ? ` 중복 ${skippedCount}개는 제외했습니다.` : ""}`);
      setShowRecommendationDialog(false);
    }
    setCreatingRecommendations(false);
  };

  const fixScheduleSort = () => {
    if (projectId === null) return;
    const nextEnabled = !scheduleSortEnabled;
    localStorage.setItem(`roadmap:schedule-sort:${projectId}`, String(nextEnabled));
    setScheduleSortEnabled(nextEnabled);
    setRecommendationMessage("");
    setError("");
    setRecommendationMessage(nextEnabled
      ? "날짜순 정렬을 이 프로젝트의 고정 보기로 저장했습니다."
      : "날짜순 고정 정렬을 해제했습니다.");
  };

  const disableScheduleSortAfterManualMove = () => {
    if (!scheduleSortEnabled || projectId === null) return;
    localStorage.setItem(`roadmap:schedule-sort:${projectId}`, "false");
    setScheduleSortEnabled(false);
    setRecommendationMessage("업무를 직접 이동해 날짜순 고정 정렬을 해제했습니다.");
  };

  const loadTaskChecklist = async (taskId: string) => {
    if (projectId === null || checklistLoadState[taskId] === "loading" || checklistLoadState[taskId] === "ready") return;
    setChecklistLoadState((current) => ({ ...current, [taskId]: "loading" }));
    try {
      const items = await fetchChecklist(taskId, Number(projectId));
      setTaskChecklists((current) => ({ ...current, [taskId]: items }));
      setChecklistLoadState((current) => ({ ...current, [taskId]: "ready" }));
    } catch {
      setChecklistLoadState((current) => ({ ...current, [taskId]: "error" }));
    }
  };

  const deleteProjectStage = async (milestoneId: string) => {
    if (!roadmap || projectId === null || deletingMilestoneId !== null) return;
    const milestone = roadmap.milestones.find((item) => item.id === milestoneId);
    if (!milestone) return;
    const taskCount = milestone.tasks.length;
    const confirmed = window.confirm(
      `"${milestone.title}" 단계를 삭제할까요?\n이 단계의 업무 ${taskCount}개는 삭제되지 않고 단계 미지정으로 이동합니다.`,
    );
    if (!confirmed) return;

    const previous = roadmap;
    const previousSelectedTask = selectedTask;
    const previousExpanded = new Set(expanded);
    const previousUnassignedOpen = unassignedOpen;
    const unassignedOffset = roadmap.unassignedTasks.length;
    const movedTasks = milestone.tasks.map((task, index) => ({
      ...task,
      milestoneId: null,
      position: unassignedOffset + index,
    }));
    setDeletingMilestoneId(milestoneId);
    setError("");
    setRecommendationMessage("");
    setRoadmap({
      ...roadmap,
      milestones: roadmap.milestones.filter((item) => item.id !== milestoneId),
      unassignedTasks: [...roadmap.unassignedTasks, ...movedTasks],
    });
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(milestoneId);
      return next;
    });
    setSelectedTask((current) =>
      current?.milestoneId === milestoneId ? { ...current, milestoneId: null } : current);
    setUnassignedOpen(true);

    try {
      await deleteMilestone(projectId, milestoneId);
      setRecommendationMessage(
        `"${milestone.title}" 단계를 삭제하고 업무 ${taskCount}개를 단계 미지정으로 이동했습니다.`,
      );
    } catch (cause) {
      setRoadmap(previous);
      setSelectedTask(previousSelectedTask);
      setExpanded(previousExpanded);
      setUnassignedOpen(previousUnassignedOpen);
      setError(cause instanceof Error ? cause.message : "단계를 삭제하지 못했습니다.");
    } finally {
      setDeletingMilestoneId(null);
    }
  };

  const dropTask = async (event: DragEvent, targetMilestoneId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragTaskIds.length === 0 || !roadmap || !canManageMilestones || projectId === null) return;
    const previous = roadmap;
    const taskIds = [...dragTaskIds];
    const movedRoadmap = moveTasksToMilestone(roadmap, taskIds, targetMilestoneId);
    const targetTasks = targetMilestoneId === null
      ? movedRoadmap.unassignedTasks
      : movedRoadmap.milestones.find((milestone) => milestone.id === targetMilestoneId)?.tasks ?? [];
    setRoadmap(movedRoadmap);
    setDropTarget(null);
    try {
      await updateRoadmapTaskLayout(projectId, targetTasks.map((task) => ({
        taskId: task.id,
        milestoneId: targetMilestoneId,
        position: task.position,
      })));
      disableScheduleSortAfterManualMove();
      setSelectedTaskIds(new Set());
    } catch (cause) {
      setRoadmap(previous);
      setError(cause instanceof Error ? cause.message : "선택한 업무를 이동하지 못했습니다.");
    } finally {
      setDragTaskIds([]);
      setDragRowTarget(null);
    }
  };

  const dropTaskOnRow = async (
    event: DragEvent<HTMLButtonElement>,
    targetTask: RoadmapTask,
    placement: "before" | "after",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragTaskIds.length === 0 || !roadmap || !canManageMilestones || projectId === null) return;
    const result = reorderTasksAtTarget(roadmap, dragTaskIds, targetTask.id, placement);
    if (!result) {
      setDragRowTarget(null);
      return;
    }

    const previous = roadmap;
    setRoadmap(result.roadmap);
    setDropTarget(null);
    setDragRowTarget(null);
    try {
      await updateRoadmapTaskLayout(projectId, result.orderedTargetTasks.map((task) => ({
        taskId: task.id,
        milestoneId: targetTask.milestoneId,
        position: task.position,
      })));
      disableScheduleSortAfterManualMove();
      setSelectedTaskIds(new Set());
    } catch (cause) {
      setRoadmap(previous);
      setError(cause instanceof Error ? cause.message : "업무 순서를 변경하지 못했습니다.");
    } finally {
      setDragTaskIds([]);
    }
  };

  const dragOver = (event: DragEvent, target: string) => {
    if (!canManageMilestones) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };

  const dragLeave = (event: DragEvent, target: string) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropTarget((current) => current === target ? null : current);
  };

  if (loadState === "loading") {
    return <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="w-4 h-4 animate-spin" />로드맵을 불러오는 중...</div>;
  }
  if (loadState === "error" || !roadmap || !range) {
    return <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><AlertTriangle className="w-5 h-5" /><span>{error || "로드맵을 불러오지 못했습니다."}</span><button onClick={() => void loadRoadmap()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground flex items-center gap-2"><RefreshCw className="w-4 h-4" />다시 시도</button></div>;
  }

  const displayedRoadmap = scheduleSortEnabled ? sortRoadmapBySchedule(roadmap) : roadmap;
  const filteredMilestones = displayedRoadmap.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.filter((task) => taskMatches(task, statusFilter, query)),
  }));
  const filteredUnassigned = displayedRoadmap.unassignedTasks.filter((task) => taskMatches(task, statusFilter, query));
  const timelineMinWidth = zoom === "week"
    ? Math.max(720, segments.length * 112)
    : Math.max(720, segments.length * 160);
  const roadmapMinWidth = 300 + timelineMinWidth;

  const renderTaskRow = (task: RoadmapTask) => {
    const style = barStyle(task.startDate, task.dueDate, range);
    const hasSchedule = Boolean(task.startDate || task.dueDate);
    const overlapsVisibleRange = intervalOverlapsRange(task.startDate, task.dueDate, range);
    const dueOnly = !task.startDate && Boolean(task.dueDate);
    const dueLeft = dueOnly ? positionPercent(task.dueDate, range) : null;
    const isMultiSelected = selectedTaskIds.has(task.id);
    const beforeDropKey = `${task.id}:before`;
    const afterDropKey = `${task.id}:after`;
    const checklist = taskChecklists[task.id] ?? [];
    const checklistState = checklistLoadState[task.id];
    const completedChecklistCount = checklist.filter((item) => item.done).length;
    const alignHoverCardRight = Number.parseFloat(String(style?.left ?? "0")) > 60;
    const alignAssigneeRight = Number.parseFloat(String(style?.left ?? "0"))
      + Number.parseFloat(String(style?.width ?? "0")) > 80;
    return (
      <button
        key={task.id}
        type="button"
        draggable={canManageMilestones}
        aria-pressed={isMultiSelected}
        onDragStart={(event) => {
          const ids = isMultiSelected ? [...selectedTaskIds] : [task.id];
          if (event.shiftKey && !isMultiSelected) {
            ids.push(...[...selectedTaskIds].filter((id) => id !== task.id));
            setSelectedTaskIds(new Set(ids));
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", ids.join(","));
          setDragTaskIds(ids);
        }}
        onDragEnd={() => { setDragTaskIds([]); setDropTarget(null); setDragRowTarget(null); }}
        onDragOver={(event) => {
          if (!canManageMilestones || dragTaskIds.includes(task.id)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
          setDragRowTarget(placement === "before" ? beforeDropKey : afterDropKey);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragRowTarget(null);
        }}
        onDrop={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const placement = dragRowTarget === beforeDropKey
            ? "before"
            : dragRowTarget === afterDropKey
              ? "after"
              : event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
          void dropTaskOnRow(event, task, placement);
        }}
        onClick={(event) => {
          setSelectedTask(task);
          if (event.shiftKey) {
            setSelectedTaskIds((current) => {
              const next = new Set(current);
              if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
              return next;
            });
          } else {
            setSelectedTaskIds(new Set());
          }
        }}
        className={`relative w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[52px] border-b border-border text-left hover:bg-accent/40 transition-colors ${hoveredTaskId === task.id ? "z-20" : ""} ${dragRowTarget === beforeDropKey ? "border-t-2 border-t-primary" : ""} ${dragRowTarget === afterDropKey ? "border-b-2 border-b-primary" : ""} ${isMultiSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : selectedTask?.id === task.id ? "bg-accent/60" : ""}`}
      >
        <span className="sticky left-0 z-10 px-4 py-2 flex items-center gap-2 border-r border-border min-w-0 bg-background">
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
          {overlapsVisibleRange && !dueOnly && style && (
            <span
              aria-label={`${task.title} 일정 막대`}
              aria-describedby={hoveredTaskId === task.id ? `roadmap-task-tooltip-${task.id}` : undefined}
              onMouseEnter={() => {
                setHoveredTaskId(task.id);
                void loadTaskChecklist(task.id);
              }}
              onMouseLeave={() => setHoveredTaskId((current) => current === task.id ? null : current)}
              className="absolute top-2.5 h-9 overflow-visible"
              style={style}
            >
              <span
                data-task-schedule-line
                className={`block h-2 w-full rounded-full ${STATUS_COLORS[task.status] ?? STATUS_COLORS.todo}`}
              />
              <span
                data-task-assignee-label
                title={task.assigneeName ?? "미배정"}
                className={`absolute top-3 max-w-40 whitespace-normal break-keep rounded-md px-2 py-1 text-[10px] font-semibold leading-tight shadow-sm ${alignAssigneeRight ? "right-0" : "left-0"} ${STATUS_COLORS[task.status] ?? STATUS_COLORS.todo}`}
              >
                {task.assigneeName ?? "미배정"}
              </span>
              {hoveredTaskId === task.id && (
                <span
                  id={`roadmap-task-tooltip-${task.id}`}
                  role="tooltip"
                  className={`absolute top-full mt-2 w-80 rounded-2xl border border-border bg-popover p-4 text-left text-popover-foreground shadow-2xl ${alignHoverCardRight ? "right-0" : "left-0"}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{task.title}</span>
                      <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                        {task.assigneeName ?? "미배정"} · {formatDate(task.startDate)}–{formatDate(task.dueDate)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] ${STATUS_COLORS[task.status] ?? STATUS_COLORS.todo}`}>
                      {STATUS_LABELS[task.status] ?? task.status}
                    </span>
                  </span>
                  <span className="mt-3 block rounded-xl bg-muted/60 p-3 text-[11px] font-normal leading-relaxed">
                    {task.description?.trim() || "등록된 업무 상세 내용이 없습니다."}
                  </span>
                  <span className="mt-3 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <ClipboardList className="h-3.5 w-3.5 text-primary" /> 체크리스트
                    </span>
                    {checklistState === "ready" && checklist.length > 0 && (
                      <span className="text-[10px] font-normal text-muted-foreground">{completedChecklistCount}/{checklist.length} 완료</span>
                    )}
                  </span>
                  {checklistState === "loading" && (
                    <span className="mt-2 flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground">
                      <LoaderCircle className="h-3 w-3 animate-spin" /> 불러오는 중...
                    </span>
                  )}
                  {checklistState === "error" && <span className="mt-2 block text-[10px] font-normal text-destructive">체크리스트를 불러오지 못했습니다.</span>}
                  {checklistState === "ready" && checklist.length === 0 && <span className="mt-2 block text-[10px] font-normal text-muted-foreground">등록된 체크리스트가 없습니다.</span>}
                  {checklistState === "ready" && checklist.length > 0 && (
                    <span className="mt-2 block space-y-1.5">
                      {checklist.slice(0, 5).map((item) => (
                        <span key={item.id} className="flex items-start gap-1.5 text-[10px] font-normal">
                          {item.done
                            ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            : <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
                        </span>
                      ))}
                      {checklist.length > 5 && <span className="block pl-5 text-[9px] font-normal text-muted-foreground">외 {checklist.length - 5}개</span>}
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[10px] text-muted-foreground">{roadmap.project.title} / 계획 관리</div><h1 className="text-xl font-semibold mt-1">팀 로드맵</h1></div>
          <div className="flex flex-wrap justify-end items-center gap-2">
            <div aria-label="상태 색상 안내" className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <span key={status} className="flex items-center gap-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.todo}`} />
                  {label}
                </span>
              ))}
            </div>
            <button onClick={() => setZoom("month")} className={`px-3 py-1.5 rounded-lg text-xs border ${zoom === "month" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>월</button>
            <button onClick={() => setZoom("week")} className={`px-3 py-1.5 rounded-lg text-xs border ${zoom === "week" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>주</button>
            <button
              type="button"
              aria-pressed={scheduleSortEnabled}
              onClick={fixScheduleSort}
              className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${scheduleSortEnabled ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
              날짜순 정렬
            </button>
            {canManageMilestones && (
              <button
                type="button"
                disabled={!canCreateMilestones || creatingRecommendations}
                title={!hasProjectRange ? "프로젝트 시작일과 종료일을 먼저 설정하세요." : undefined}
                onClick={openProjectRecommendations}
                className="px-3 py-1.5 rounded-lg text-xs border border-primary text-primary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creatingRecommendations ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                프로젝트 단계 추천
              </button>
            )}
            {canManageMilestones && <button disabled={!canCreateMilestones} title={!hasProjectRange ? "프로젝트 시작일과 종료일을 먼저 설정하세요." : undefined} onClick={() => setShowMilestoneForm(true)} className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Flag className="w-3.5 h-3.5" />새 단계</button>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-muted-foreground">검색<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업무명 또는 담당자" className="block mt-1 w-48 px-3 py-2 rounded-lg border border-border bg-input-background text-xs text-foreground outline-none" /></label>
          <label className="text-[10px] text-muted-foreground">상태<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="block mt-1 px-3 py-2 rounded-lg border border-border bg-input-background text-xs text-foreground"><option value="all">전체</option><option value="todo">할 일</option><option value="inprogress">진행 중</option><option value="blocked">막힘</option><option value="done">완료</option></select></label>
          {canManageMilestones && <span className="text-[10px] text-muted-foreground pb-2">{selectedTaskIds.size > 0 ? `${selectedTaskIds.size}개 선택됨 · 선택된 업무를 드래그해 함께 이동` : "Shift+클릭으로 여러 업무 선택"}</span>}
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />프로젝트 {formatFullDate(roadmap.project.startDate)}–{formatFullDate(roadmap.project.deadline)}</span>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        {recommendationMessage && <div className="mt-2 text-xs text-emerald-600">{recommendationMessage}</div>}
        {!hasProjectRange && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>프로젝트 시작일과 종료일이 없어 현재 시점부터 3개월을 임시로 표시합니다.</span>
            {canManageMilestones && <button type="button" onClick={() => navigate("/mypage#project-settings")} className="ml-auto font-semibold text-amber-900 underline underline-offset-2">프로젝트 일정 설정</button>}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        <div className="w-full relative" style={{ minWidth: `${roadmapMinWidth}px` }}>
          <div
            data-roadmap-column-header
            className="sticky top-0 z-30 w-full grid grid-cols-[300px_minmax(520px,1fr)] h-11 bg-muted border-b border-border shadow-sm"
          >
            <div className="sticky left-0 z-40 px-4 flex items-center border-r border-border bg-muted text-xs font-semibold">단계 / 업무</div>
            <div className="relative">
              {segments.map((segment) => <div key={segment.key} className="absolute inset-y-0 border-r border-border flex items-center justify-center text-[10px] text-muted-foreground" style={{ left: `${segment.left}%`, width: `${segment.width}%` }}>{segment.label}</div>)}
            </div>
          </div>

          {filteredMilestones.map((milestone, index) => {
            const open = expanded.has(milestone.id);
            const milestoneStyle = barStyle(milestone.startDate, milestone.dueDate, range);
            const targetKey = milestone.id;
            return (
              <div
                key={milestone.id}
                data-drop-target={targetKey}
                onDragEnter={() => {
                  setDropTarget(targetKey);
                  setExpanded((current) => current.has(milestone.id) ? current : new Set([...current, milestone.id]));
                }}
                onDragOver={(event) => dragOver(event, targetKey)}
                onDrop={(event) => void dropTask(event, milestone.id)}
                onDragLeave={(event) => dragLeave(event, targetKey)}
                className={`transition-shadow ${dropTarget === targetKey ? "ring-2 ring-inset ring-primary bg-primary/5" : ""}`}
              >
                <div className="grid grid-cols-[300px_minmax(520px,1fr)] min-h-[58px] border-b border-border bg-muted/50">
                  <div className="sticky left-0 z-20 flex min-w-0 items-center border-r border-border bg-muted">
                    <button onClick={() => toggleExpanded(milestone.id)} className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left">
                      {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0">{index + 1}단계</span>
                      <span className="min-w-0"><span className="block text-xs font-semibold truncate">{milestone.title}</span><span className="block text-[10px] text-muted-foreground">{formatDate(milestone.startDate)}–{formatDate(milestone.dueDate)} · {milestone.progressPercent}%</span></span>
                    </button>
                    {canManageMilestones && (
                      <button
                        type="button"
                        aria-label={`${milestone.title} 단계 삭제`}
                        title="단계 삭제"
                        disabled={deletingMilestoneId !== null}
                        onClick={() => void deleteProjectStage(milestone.id)}
                        className="mr-2 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      >
                        {deletingMilestoneId === milestone.id
                          ? <LoaderCircle className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <div className="relative bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(25%-1px),var(--border)_calc(25%-1px),var(--border)_25%)]">
                    {milestoneStyle && (
                      <span
                        aria-label={`${milestone.title} 마일스톤 기간 ${formatDate(milestone.startDate)}부터 ${formatDate(milestone.dueDate)}까지, 진행률 ${milestone.progressPercent}%`}
                        title={`${milestone.title} · ${formatDate(milestone.startDate)}–${formatDate(milestone.dueDate)} · ${milestone.progressPercent}% 완료`}
                        className="absolute top-5 h-3 overflow-hidden rounded-full bg-primary/15 ring-1 ring-inset ring-primary/15"
                        style={milestoneStyle}
                      >
                        <span
                          className="block h-full rounded-full bg-primary shadow-sm"
                          style={{ width: `${milestone.progressPercent}%` }}
                        />
                      </span>
                    )}
                  </div>
                </div>
                {open && milestone.tasks.map(renderTaskRow)}
              </div>
            );
          })}

          {(filteredUnassigned.length > 0 || roadmap.unassignedTasks.length === 0) && (
            <div
              data-drop-target="unassigned"
              onDragEnter={() => {
                setDropTarget("unassigned");
                setUnassignedOpen(true);
              }}
              onDragOver={(event) => dragOver(event, "unassigned")}
              onDrop={(event) => void dropTask(event, null)}
              onDragLeave={(event) => dragLeave(event, "unassigned")}
              className={`transition-shadow ${dropTarget === "unassigned" ? "ring-2 ring-inset ring-primary bg-primary/5" : ""}`}
            >
              <button type="button" onClick={() => setUnassignedOpen((open) => !open)} className="w-full grid grid-cols-[300px_minmax(520px,1fr)] min-h-[48px] border-b border-border bg-muted/40 text-left">
                <span className="sticky left-0 z-10 px-4 border-r border-border bg-muted flex items-center gap-2 text-xs font-semibold">
                  {unassignedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <AlertTriangle className="w-4 h-4 text-amber-500" />단계 미지정
                  <span className="text-muted-foreground font-normal">{roadmap.unassignedTasks.length}</span>
                </span>
                <span className="px-4 flex items-center text-[10px] text-muted-foreground">클릭해서 업무 목록 {unassignedOpen ? "접기" : "펼치기"}</span>
              </button>
              {unassignedOpen && filteredUnassigned.map(renderTaskRow)}
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

      {showRecommendationDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creatingRecommendations) {
              setShowRecommendationDialog(false);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-recommendation-title"
            onSubmit={(event) => void createRecommendedStages(event)}
            className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h2 id="project-recommendation-title" className="text-lg font-semibold">프로젝트 단계 추천</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  캡스톤디자인 진행 흐름을 기준으로 추천했습니다. 생성 전에 단계명과 기간을 자유롭게 수정할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                aria-label="추천 팝업 닫기"
                disabled={creatingRecommendations}
                onClick={() => setShowRecommendationDialog(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-[minmax(180px,1fr)_150px_150px_36px] gap-2 px-2 pb-2 text-[10px] font-semibold text-muted-foreground">
                <span>단계명</span><span>시작일</span><span>마감일</span><span />
              </div>
              <div className="space-y-2">
                {recommendationDrafts.map((draft, index) => (
                  <div
                    key={draft.id}
                    className="grid grid-cols-[minmax(180px,1fr)_150px_150px_36px] items-center gap-2 rounded-xl border border-border bg-background p-2"
                  >
                    <input
                      required
                      aria-label={`단계명 ${index + 1}`}
                      maxLength={200}
                      value={draft.title}
                      onChange={(event) => updateRecommendationDraft(draft.id, { title: event.target.value })}
                      className="min-w-0 rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                    <input
                      required
                      type="date"
                      aria-label={`추천 시작일 ${index + 1}`}
                      min={roadmap.project.startDate ?? undefined}
                      max={draft.dueDate || roadmap.project.deadline || undefined}
                      value={draft.startDate}
                      onChange={(event) => updateRecommendationDraft(draft.id, { startDate: event.target.value })}
                      className="min-w-0 rounded-lg border border-border bg-input-background px-2 py-2 text-xs outline-none focus:border-primary"
                    />
                    <input
                      required
                      type="date"
                      aria-label={`추천 마감일 ${index + 1}`}
                      min={draft.startDate || roadmap.project.startDate || undefined}
                      max={roadmap.project.deadline ?? undefined}
                      value={draft.dueDate}
                      onChange={(event) => updateRecommendationDraft(draft.id, { dueDate: event.target.value })}
                      className="min-w-0 rounded-lg border border-border bg-input-background px-2 py-2 text-xs outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      aria-label={`${index + 1}번째 추천 단계 삭제`}
                      disabled={creatingRecommendations}
                      onClick={() => setRecommendationDrafts((current) => current.filter((item) => item.id !== draft.id))}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled={creatingRecommendations}
                onClick={addRecommendationDraft}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-xs font-medium text-primary disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> 단계 행 추가
              </button>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                disabled={creatingRecommendations}
                onClick={() => setShowRecommendationDialog(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={creatingRecommendations || recommendationDrafts.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"
              >
                {creatingRecommendations && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                선택 단계 생성
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedTask && <div className="shrink-0 px-6 py-2.5 border-t border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><strong>{selectedTask.title}</strong><span className="text-muted-foreground">{selectedTask.assigneeName ?? "미배정"}</span><span className="text-muted-foreground">{formatDate(selectedTask.startDate)}–{formatDate(selectedTask.dueDate)}</span><span className="px-2 py-0.5 rounded-full bg-muted">{STATUS_LABELS[selectedTask.status] ?? selectedTask.status}</span></div>}
    </div>
  );
}
