import { useMemo, useState, type UIEvent } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, AlertTriangle, Bell, Calendar, CheckCircle2, Clock, Search, Sparkles, UserCog } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { PriorityBadge } from "../../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../../board/components/TaskStatusPill";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { updateTaskPosition } from "../../../board/libs/utils/taskApi";
import { TaskDueDatePopup } from "../../components/TaskDueDatePopup";
import { TaskAssigneePopup } from "../../components/TaskAssigneePopup";
import {
  daysUntilDue,
  formatDashboardDueDate,
  isOpenTask,
  nextPositionForStatus,
  normalizePriority,
  normalizeTaskStatus,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";

const GROUPS = [
  { label: "이미 지연", key: "overdue", color: "#6B7280", bg: "bg-slate-50 border-slate-200" },
  { label: "오늘 마감", key: "today", color: "#EF4444", bg: "bg-red-50 border-red-200" },
  { label: "3일 이내", key: "3day", color: "#F97316", bg: "bg-orange-50 border-orange-200" },
  { label: "7일 이내", key: "week", color: "#F59E0B", bg: "bg-amber-50 border-amber-200" },
] as const;

const PAGE_SIZE = 15;

const STATUS_CHANGE_LABEL: Record<"done" | "blocked", string> = {
  done: "완료",
  blocked: "블로커",
};

function urgencyKey(daysLeft: number | null) {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  if (daysLeft <= 3) return "3day";
  if (daysLeft <= 7) return "week";
  return null;
}

export function UrgentTasksPage() {
  const { currentProjectId } = useAuth();
  const { data: tasks, loading, error, refetch } = useDashboardTasks(currentProjectId);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("전체");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [dueDateTarget, setDueDateTarget] = useState<string | null>(null);
  const [assigneeTarget, setAssigneeTarget] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const assigneeOptions = useMemo(
    () => Array.from(new Set(tasks.map(task => task.assigneeName).filter(Boolean))) as string[],
    [tasks]
  );

  const urgentTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter(isOpenTask)
      .map(task => ({ task, daysLeft: daysUntilDue(task.dueDate) }))
      .filter(({ task, daysLeft }) => {
        const key = urgencyKey(daysLeft);
        const matchesQuery = !query || task.title.toLowerCase().includes(query);
        const matchesAssignee = assigneeFilter === "전체" || task.assigneeName === assigneeFilter;
        return key && matchesQuery && matchesAssignee;
      })
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  }, [assigneeFilter, search, tasks]);

  const selectedRow = urgentTasks.find(row => row.task.id === selected) ?? urgentTasks[0] ?? null;
  const dueDateRow = urgentTasks.find(row => row.task.id === dueDateTarget) ?? null;
  const assigneeRow = urgentTasks.find(row => row.task.id === assigneeTarget) ?? null;
  const counts = Object.fromEntries(GROUPS.map(group => [
    group.key,
    urgentTasks.filter(row => urgencyKey(row.daysLeft) === group.key).length,
  ])) as Record<(typeof GROUPS)[number]["key"], number>;

  const urgentQuestion = `마감 임박 업무 ${urgentTasks.length}개를 점검해줘. 오늘 마감인 업무는 ${counts.today}개, 3일 이내에 마감하는 업무는 ${counts["3day"]}개, 7일 이내에 마감하는 업무는 ${counts.week}개, 이미 지연된 업무는 ${counts.overdue}개야. 지금 가장 확인할 업무와 권장 조치를 우선순위대로 알려줘. 출력은 3문장 이내로 해.`;

  const changeStatus = async (taskId: string, taskTitle: string, status: "done" | "blocked") => {
    if (currentProjectId == null) return;
    if (!window.confirm(`'${taskTitle}' 업무를 ${STATUS_CHANGE_LABEL[status]}(으)로 변경할까요?`)) return;
    setActionError(null);
    setPendingTaskId(taskId);
    try {
      await updateTaskPosition(taskId, status, nextPositionForStatus(tasks, status), currentProjectId);
      alert("변경이 완료되었습니다.");
      refetch();
    } catch {
      setActionError("상태 변경에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setPendingTaskId(null);
    }
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, urgentTasks.length));
    }
  };

  let remainingVisible = visibleCount;

  return (
    <div className="h-full overflow-hidden flex flex-col p-6 gap-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between shrink-0">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">마감 임박 업무</h1>
          <p className="text-sm text-muted-foreground mt-0.5">마감이 가까운 업무와 지연된 업무를 우선순위별로 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => openAIAssistant(urgentQuestion)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
            <Sparkles className="w-3.5 h-3.5" /> AI 마감 위험 분석
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>}

      <div className="grid grid-cols-4 gap-3 shrink-0">
        <DetailStatCard label="오늘 마감" value={loading ? "..." : counts.today} sub="즉시 확인 필요" color="#EF4444" icon={AlertCircle} />
        <DetailStatCard label="3일 이내" value={loading ? "..." : counts["3day"]} sub="긴급 처리 필요" color="#F97316" icon={AlertTriangle} />
        <DetailStatCard label="7일 이내" value={loading ? "..." : counts.week} sub="이번 주 완료 목표" color="#F59E0B" icon={Clock} />
        <DetailStatCard label="이미 지연" value={loading ? "..." : counts.overdue} sub="즉시 담당자 확인" color="#6B7280" icon={AlertTriangle} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={urgentQuestion}
        ready={!loading}
        fallbackText="마감 임박·지연 업무를 바탕으로 지금 확인할 업무와 권장 조치를 추천받을 수 있습니다."
      />

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="업무명 검색" className="pl-9 pr-4 py-2 text-xs rounded-lg border border-border bg-card outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 w-48" />
        </div>
        <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)} className="text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground outline-none">
          <option>전체</option>
          {assigneeOptions.map(name => <option key={name}>{name}</option>)}
        </select>
        <div className="ml-auto text-xs text-muted-foreground">{urgentTasks.length}개 업무</div>
      </div>

      <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
        <div className="flex-1 overflow-y-auto space-y-3" onScroll={handleScroll}>
          {GROUPS.map(group => {
            const grouped = urgentTasks.filter(row => urgencyKey(row.daysLeft) === group.key);
            if (!grouped.length) return null;
            const visibleRows = remainingVisible > 0 ? grouped.slice(0, remainingVisible) : [];
            remainingVisible -= visibleRows.length;
            return (
              <div key={group.key}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold mb-2 ${group.bg}`} style={{ color: group.color }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: group.color }} />
                  {group.label} ({grouped.length})
                </div>
                <div className="space-y-2">
                  {visibleRows.map(({ task, daysLeft }, index) => {
                    const member = taskAssignee(task, index);
                    const status = normalizeTaskStatus(task.status);
                    const isSelected = selectedRow?.task.id === task.id;
                    return (
                      <button key={task.id} onClick={() => setSelected(task.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all text-left ${isSelected ? "border-blue-400 bg-blue-50/50" : "bg-card border-border hover:border-slate-300 hover:shadow-sm"}`}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: member.color }}>{member.initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                            <TaskStatusPill status={status} />
                            <PriorityBadge priority={normalizePriority(task.priority)} />
                          </div>
                          <div className="text-xs font-medium text-foreground truncate">{task.title}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{member.name} · 마감 {formatDashboardDueDate(task.dueDate)}</div>
                        </div>
                        <div className="shrink-0 text-center">
                          <div className="text-lg font-bold" style={{ color: group.color }}>{daysLeft != null && daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft ?? "-"}`}</div>
                          <div className="text-[9px] text-muted-foreground">남은 일수</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {(loading || urgentTasks.length === 0) && (
            <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
              {loading ? "데이터를 불러오는 중입니다" : "마감 임박 업무가 없습니다."}
            </div>
          )}
        </div>

        {selectedRow && (
          <div className="w-72 shrink-0 bg-card border border-border rounded-xl overflow-y-auto">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground">{selectedRow.task.id}</span>
                <TaskStatusPill status={normalizeTaskStatus(selectedRow.task.status)} />
              </div>
              <div className="text-sm font-semibold text-foreground leading-snug mb-1.5">{selectedRow.task.title}</div>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{selectedRow.task.category ?? "미분류"}</span>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">담당자</div>
                  <div className="font-medium text-foreground">{selectedRow.task.assigneeName ?? "미배정"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">우선순위</div>
                  <PriorityBadge priority={normalizePriority(selectedRow.task.priority)} />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">마감일</div>
                  <span className="font-semibold text-foreground">{formatDashboardDueDate(selectedRow.task.dueDate)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">남은 시간</div>
                  <span className="font-bold" style={{ color: selectedRow.daysLeft != null && selectedRow.daysLeft <= 3 ? "#EF4444" : "#F59E0B" }}>
                    {selectedRow.daysLeft != null && selectedRow.daysLeft < 0 ? `D+${Math.abs(selectedRow.daysLeft)}` : `D-${selectedRow.daysLeft ?? "-"}`}
                  </span>
                </div>
              </div>
              {selectedRow.task.description && (
                <div className="text-xs text-muted-foreground leading-relaxed rounded-lg border border-border bg-muted/40 p-3">
                  {selectedRow.task.description}
                </div>
              )}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">빠른 액션</div>
                <button onClick={() => alert("미구현된 기능입니다.")} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"><Bell className="w-3.5 h-3.5" />리마인드 알림 보내기</button>
                <button onClick={() => setAssigneeTarget(selectedRow.task.id)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><UserCog className="w-3.5 h-3.5" />담당자 변경</button>
                <button onClick={() => setDueDateTarget(selectedRow.task.id)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><Calendar className="w-3.5 h-3.5" />마감일 조정</button>
                <button
                  onClick={() => changeStatus(selectedRow.task.id, selectedRow.task.title, "done")}
                  disabled={pendingTaskId === selectedRow.task.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                ><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />완료 처리</button>
                <button
                  onClick={() => changeStatus(selectedRow.task.id, selectedRow.task.title, "blocked")}
                  disabled={pendingTaskId === selectedRow.task.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                ><AlertTriangle className="w-3.5 h-3.5 text-red-500" />블로커로 지정</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {dueDateRow && currentProjectId != null && (
        <TaskDueDatePopup
          task={dueDateRow.task}
          projectId={currentProjectId}
          onClose={() => setDueDateTarget(null)}
          onChanged={() => { setDueDateTarget(null); refetch(); }}
        />
      )}
      {assigneeRow && currentProjectId != null && (
        <TaskAssigneePopup
          task={assigneeRow.task}
          projectId={currentProjectId}
          onClose={() => setAssigneeTarget(null)}
          onChanged={() => { setAssigneeTarget(null); refetch(); }}
        />
      )}
    </div>
  );
}
