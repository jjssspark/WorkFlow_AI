import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Layers, Plus, RefreshCw, Users, X } from "lucide-react";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { PriorityBadge } from "../../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../../board/components/TaskStatusPill";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardSummary } from "../../libs/hooks/useDashboardSummary";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { useWorkloadScore } from "../../libs/hooks/useWorkloadScore";
import type { WorkloadScoreMemberDto } from "../../libs/utils/workloadScoreApi";
import {
  formatDashboardDueDate,
  normalizePriority,
  normalizeTaskStatus,
} from "../../libs/utils/dashboardTaskUtils";
import { resolveMemberDisplay } from "../../libs/utils/memberDisplay";
import { EditTaskModal } from "../../../board/components/EditTaskModal";
import { TaskDetailPopup } from "../../components/TaskDetailPopup";
import { getProjectMembers, type MemberResponse } from "../../../global/api/projectsApi";
import type { DashboardTaskDto } from "../../libs/types/dashboard";
import type { Priority, Task, TaskStatus } from "../../../board/libs/types/task";

// 계산 시각을 기록하기 전에 캐시된 옛 결과는 null로 온다 - 그 경우 시각을 지어내지 않고
// 알 수 없음을 그대로 밝힌다.
export function formatWorkloadCalculatedAt(isoString: string | null): string {
  if (!isoString) return "알 수 없음 (재계산하면 기록됩니다)";
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return "알 수 없음 (재계산하면 기록됩니다)";
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

// 대시보드 업무 카드(DashboardTaskDto)를 업무 상세창의 '업무 수정' 모달이 기대하는 Task 형태로 변환한다.
function dashboardTaskToBoardTask(task: DashboardTaskDto): Task {
  return {
    id: task.id,
    title: task.title,
    status: normalizeTaskStatus(task.status) as TaskStatus,
    priority: normalizePriority(task.priority) as Priority,
    assignee: task.assigneeId ?? "",
    startDate: "",
    dueDate: task.dueDate ?? "",
    labels: [],
    category: task.category ?? "other",
    position: task.position,
    description: task.description ?? undefined,
    pendingApproval: false,
    extraFields: {},
  };
}

// "대기" 계열(#C1C9D9)은 밝아서 기본 툴팁 텍스트로는 눈에 잘 안 띄기 때문에, 항목별로 글자색을 따로 지정한다.
const WORKLOAD_LABEL_TEXT_COLOR: Record<string, string> = {
  완료: "#10B981",
  진행중: "#3B5BDB",
  대기: "#475569",
  "검토 필요": "#EF4444",
};

function WorkloadTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "#1C2333" }}>{label}</div>
      {payload.map(entry => (
        <div key={entry.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: WORKLOAD_LABEL_TEXT_COLOR[entry.dataKey] ?? "#1C2333" }}>
          <span>{entry.dataKey}</span><span style={{ fontWeight: 600 }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

const ANOMALY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "과부하 의심": { label: "과부하 의심", color: "#DC2626", bg: "#FEF2F2" },
  "저활동 의심": { label: "저활동 의심", color: "#D97706", bg: "#FFFBEB" },
};

const NORMAL_CATEGORY_COLOR = "#16A34A";

export function WorkloadPage() {
  const { currentProjectId, currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";
  const { data: summary, loading: summaryLoading, error: summaryError, refetch: refetchSummary } = useDashboardSummary(currentProjectId);
  const { data: tasks, loading: tasksLoading, error: tasksError, refetch } = useDashboardTasks(currentProjectId);
  const { data: workloadScore, loading: workloadScoreLoading, error: workloadScoreError, refreshWorkloadScore } = useWorkloadScore(currentProjectId);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [assignEditTarget, setAssignEditTarget] = useState<DashboardTaskDto | null>(null);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [detailTarget, setDetailTarget] = useState<DashboardTaskDto | null>(null);
  const [taskListRefreshing, setTaskListRefreshing] = useState(false);

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

  const workload = summary?.workload ?? [];
  const memberCount = workload.length;
  const assignedInProgressTotal = workload.reduce((sum, member) => sum + member.inProgress, 0);
  const averageInProgressTasks = memberCount === 0 ? 0 : Math.round((assignedInProgressTotal / memberCount) * 10) / 10;

  // "과부하 위험" 판정은 ml_workload_score(FastAPI)의 실제 이상치 탐지 결과만 신뢰한다.
  // 점수를 못 불러왔을 때 휴리스틱으로 조용히 대체하면, "N명 과부하"라고 카운트/배지는 뜨는데
  // 과부하 위험 카드와 최고 위험 팀원 이름이 "데이터 없음"이라고 나오는 모순이 생긴다(실제 발생 사례).
  const workloadScoreByAssignee = new Map<string, WorkloadScoreMemberDto>(
    (workloadScore?.members ?? []).map(member => [member.assigneeId, member])
  );
  // isAnomaly는 과부하/저활동 이상치를 모두 true로 묶어서 주기 때문에, 그대로 쓰면
  // "저활동 의심" 팀원까지 "과부하 위험"으로 잘못 표시된다 — anomalyType으로 과부하만 걸러낸다.
  const isMemberOverloaded = (member: (typeof workload)[number]) =>
    workloadScoreByAssignee.get(member.assigneeId)?.anomalyType === "과부하 의심";
  const overloaded = workload.filter(isMemberOverloaded);
  // 완료율 비교 영역에서는 팀원 프로필 색상 대신, 범례와 동일한 편중 범주 색상을 쓴다.
  const categoryColorFor = (member: (typeof workload)[number]) => {
    const anomalyType = workloadScoreByAssignee.get(member.assigneeId)?.anomalyType;
    return anomalyType ? ANOMALY_BADGE[anomalyType]?.color ?? NORMAL_CATEGORY_COLOR : NORMAL_CATEGORY_COLOR;
  };

  const overloadedByMl = (workloadScore?.members ?? []).filter(member => member.anomalyType === "과부하 의심");
  const memberNameFor = (assigneeId: string) => {
    const index = workload.findIndex(entry => entry.assigneeId === assigneeId);
    const assigneeName = index >= 0 ? workload[index].assigneeName : null;
    return resolveMemberDisplay(assigneeName, index >= 0 ? index : 0, assigneeId).name;
  };
  // "과부하 위험" 카드의 서브텍스트용 - overloadScore(ML 편중 점수)는 과부하/저활동 모두 높게 나오므로,
  // 반드시 anomalyType이 "과부하 의심"인 사람 중에서만 골라야 저활동 팀원 이름이 잘못 뜨지 않는다.
  const topOverloadedMember = overloadedByMl.reduce<WorkloadScoreMemberDto | null>(
    (top, member) => (!top || member.overloadScore > top.overloadScore ? member : top),
    null
  );
  const topOverloadedName = topOverloadedMember ? memberNameFor(topOverloadedMember.assigneeId) : null;
  const barData = workload.map((entry, index) => ({
    id: entry.assigneeId,
    name: resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId).name,
    완료: entry.done,
    진행중: entry.inProgress,
    대기: entry.todo,
    "검토 필요": entry.blocked,
  }));

  const selectedTasks = selectedMember ? tasks.filter(task => task.assigneeId === selectedMember) : [];
  const error = summaryError ?? tasksError;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">팀원별 업무량</h1>
          <p className="text-sm text-muted-foreground mt-0.5">팀원별 업무 분배 현황을 파악하고 과부하 위험을 확인합니다.</p>
          {/* 편중 점수는 화면을 열 때마다 다시 계산하지 않고 마지막 계산 결과를 돌려준다(최대 30일 보관).
              언제 기준 값인지 밝히지 않으면 묵은 점수를 방금 계산한 값으로 오해하게 된다. */}
          <p className="text-xs text-muted-foreground mt-1">
            업무 편중 점수 기준 시각: {workloadScoreLoading || pageRefreshing
              ? "계산 중..."
              : formatWorkloadCalculatedAt(workloadScore?.calculatedAt ?? null)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { setPageRefreshing(true); await Promise.all([refetch(), refetchSummary(), refreshWorkloadScore()]); setPageRefreshing(false); }}
            disabled={pageRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          ><RefreshCw className={`w-3.5 h-3.5 ${pageRefreshing ? "animate-spin" : ""}`} />새로고침</button>
          {isLeader && (
            <button onClick={() => setShowAssignPicker(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}><Plus className="w-3.5 h-3.5" />업무 배정</button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3">
        <DetailStatCard label="팀원 수" value={summaryLoading || pageRefreshing ? "..." : `${memberCount}명`} sub="프로젝트 멤버" color="#3B5BDB" icon={Users} />
        <DetailStatCard label="1인 평균 업무" value={summaryLoading || pageRefreshing ? "..." : `${averageInProgressTasks}개`} sub="진행 중 배정 기준" color="#7048E8" icon={Layers} />
        <DetailStatCard
          label="과부하 위험"
          value={
            summaryLoading || pageRefreshing ? "..." : workloadScoreError ? "...명" : `${overloaded.length}명`
          }
          sub={
            workloadScoreLoading || pageRefreshing
              ? "분석 중"
              : workloadScoreError
                ? "ML 업무편중점수 모델 로딩에 실패했습니다."
                : topOverloadedName
                  ? `${topOverloadedName}님`
                  : "위험 팀원 없음"
          }
          color="#EF4444"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">팀원별 업무 현황 비교</div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {[{ color: "#10B981", label: "완료" }, { color: "#3B5BDB", label: "진행중" }, { color: "#C1C9D9", label: "대기", textColor: "#475569" }, { color: "#EF4444", label: "검토 필요" }].map(item => (
                <span key={item.label} className="flex items-center gap-1" style={item.textColor ? { color: item.textColor } : undefined}><div className="w-2 h-2 rounded-full" style={{ background: item.color }} />{item.label}</span>
              ))}
            </div>
          </div>
          <div className="h-48">
            {summaryLoading || pageRefreshing ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">데이터를 불러오는 중입니다.</div>
            ) : barData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#8892A4" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#8892A4" }} />
                  <Tooltip content={<WorkloadTooltip />} />
                  <Bar dataKey="완료" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="진행중" stackId="a" fill="#3B5BDB" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="대기" stackId="a" fill="#C1C9D9" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="검토 필요" stackId="a" fill="#EF4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">업무량 데이터가 없습니다.</div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="text-sm font-semibold text-foreground mb-1.5">완료율 비교</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground mb-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: ANOMALY_BADGE["과부하 의심"].color }} />과부하 의심(ML 편중 점수 상위 이상치)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: ANOMALY_BADGE["저활동 의심"].color }} />저활동 의심(ML 편중 점수 하위 이상치)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: NORMAL_CATEGORY_COLOR }} />정상(이상치 아님)</span>
          </div>
          <div className="space-y-4">
            {!summaryLoading && !pageRefreshing && workload.map((entry, index) => {
              const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
              const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
              const isOverload = isMemberOverloaded(entry);
              const isUnderload = workloadScoreByAssignee.get(entry.assigneeId)?.anomalyType === "저활동 의심";
              return (
                <div key={entry.assigneeId}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: member.color }}>{member.initials}</div>
                      <span className="font-medium text-foreground">{member.name}</span>
                      {isOverload && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-600">과부하</span>}
                      {isUnderload && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700">저활동</span>}
                    </div>
                    <span className="font-semibold" style={{ color: categoryColorFor(entry) }}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: categoryColorFor(entry) }} /></div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{entry.done}/{entry.total}개 · 검토 필요 {entry.blocked}개</div>
                </div>
              );
            })}
            {(summaryLoading || pageRefreshing || workload.length === 0) && (
              <div className="text-sm text-muted-foreground">
                {summaryLoading || pageRefreshing ? "데이터를 불러오는 중입니다." : "팀원 데이터가 없습니다."}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!summaryLoading && !pageRefreshing && workload.map((entry, index) => {
          const member = resolveMemberDisplay(entry.assigneeName, index, entry.assigneeId);
          const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
          const isSelected = selectedMember === entry.assigneeId;
          const scoreEntry = workloadScoreByAssignee.get(entry.assigneeId);
          const isOverload = isMemberOverloaded(entry);
          const anomalyBadge = scoreEntry ? ANOMALY_BADGE[scoreEntry.anomalyType] : undefined;
          return (
            <button key={entry.assigneeId} onClick={() => setSelectedMember(isSelected ? null : entry.assigneeId)} className={`bg-card rounded-xl p-5 border-2 cursor-pointer transition-all shadow-sm hover:shadow-md text-left ${isSelected ? "border-blue-400" : isOverload ? "border-red-200" : "border-border"}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: member.color }}>{member.initials}</div>
                  <div><div className="text-sm font-semibold text-foreground">{member.name}</div><div className="text-xs text-muted-foreground">{member.role}</div></div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {isOverload && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">과부하 위험</span>}
                  <span className="text-lg font-bold" style={{ color: categoryColorFor(entry) }}>{pct}%</span>
                </div>
              </div>
              {scoreEntry && (
                <div className="flex items-center justify-between gap-2 mb-3 px-2.5 py-1.5 rounded-lg bg-muted/60">
                  {anomalyBadge ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: anomalyBadge.color, background: anomalyBadge.bg }}>
                      {anomalyBadge.label}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    업무 편중 점수 <span className="font-bold text-foreground">{Math.round(scoreEntry.overloadScore)}</span>/100
                  </span>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[{ label: "전체", value: entry.total, color: "#64748B" }, { label: "완료", value: entry.done, color: "#10B981" }, { label: "진행", value: entry.inProgress, color: "#3B5BDB" }, { label: "검토 필요", value: entry.blocked, color: "#EF4444" }].map(item => (
                  <div key={item.label} className="text-center p-1.5 rounded-lg bg-muted">
                    <div className="text-sm font-bold" style={{ color: item.color }}>{item.value}</div>
                    <div className="text-[9px] text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: categoryColorFor(entry) }} /></div>
            </button>
          );
        })}
        {(summaryLoading || pageRefreshing || workload.length === 0) && (
          <div className="col-span-2 h-40 flex items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            {summaryLoading || pageRefreshing ? "데이터를 불러오는 중입니다." : "팀원 데이터가 없습니다."}
          </div>
        )}
      </div>

      {selectedMember && (() => {
        const workloadEntry = workload.find(entry => entry.assigneeId === selectedMember);
        const member = resolveMemberDisplay(workloadEntry?.assigneeName, workload.findIndex(entry => entry.assigneeId === selectedMember), selectedMember);
        return (
          <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setSelectedMember(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
                <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: member.color }}>{member.initials}</div>
                    <span className="text-sm font-semibold text-foreground">{member.name}의 업무 목록</span>
                  </div>
                  <button onClick={() => setSelectedMember(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
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
                  {tasksLoading || pageRefreshing ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground">데이터를 불러오는 중입니다.</div>
                  ) : selectedTasks.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground">배정된 업무가 없습니다.</div>
                  ) : selectedTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                      <span className="font-mono text-[10px] text-muted-foreground w-12">{task.id}</span>
                      <span className="flex-1 text-xs font-medium text-foreground truncate">{task.title}</span>
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
        );
      })()}

      {showAssignPicker && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowAssignPicker(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-base font-bold text-foreground">업무 배정 — 업무 선택</h2>
                <button onClick={() => setShowAssignPicker(false)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
              <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                <span className="w-12 shrink-0">ID</span>
                <span className="flex-1">업무명</span>
                <span className="w-14 text-center">상태</span>
                <span className="w-16 text-right">담당자</span>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border">
                {tasksLoading || taskListRefreshing || pageRefreshing ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">데이터를 불러오는 중입니다.</div>
                ) : tasks.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">등록된 업무가 없습니다.</div>
                ) : tasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => { setAssignEditTarget(task); setShowAssignPicker(false); }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">{task.id}</span>
                    <span className="flex-1 text-xs font-medium text-foreground truncate">{task.title}</span>
                    <span className="w-14 flex justify-center shrink-0"><TaskStatusPill status={normalizeTaskStatus(task.status)} /></span>
                    <span className="text-[10px] text-muted-foreground w-16 text-right truncate shrink-0">{task.assigneeName ?? "미배정"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {assignEditTarget && (
        <EditTaskModal
          task={dashboardTaskToBoardTask(assignEditTarget)}
          projectMembers={projectMembers}
          onClose={() => setAssignEditTarget(null)}
          onUpdated={async () => {
            setAssignEditTarget(null);
            alert("업무 수정이 완료되었습니다.");
            setShowAssignPicker(true);
            setTaskListRefreshing(true);
            await refetch();
            setTaskListRefreshing(false);
          }}
        />
      )}
      {detailTarget && currentProjectId != null && (
        <TaskDetailPopup
          task={detailTarget}
          projectId={currentProjectId}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  );
}
