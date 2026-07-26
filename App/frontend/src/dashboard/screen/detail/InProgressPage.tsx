import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Calendar, CheckCircle2, Clock, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react";
import { AiInsightBox } from "../../../ai/components/AiInsightBox";
import { openAIAssistant } from "../../../ai/libs/utils/openAIAssistant";
import { BackBtn } from "../../../global/component/BackBtn";
import { DetailStatCard } from "../../../global/component/DetailStatCard";
import { useAuth } from "../../../global/hooks/useAuth";
import { useDashboardProgress } from "../../libs/hooks/useDashboardProgress";
import { useDashboardTasks } from "../../libs/hooks/useDashboardTasks";
import { updateTaskPosition } from "../../../board/libs/utils/taskApi";
import type { DashboardTaskDto } from "../../libs/types/dashboard";
import { TaskDueDatePopup } from "../../components/TaskDueDatePopup";
import {
  daysSince,
  formatDashboardDueDate,
  formatDDay,
  formatRelativeDate,
  isDangerDelayRisk,
  isDelayRisk,
  nextPositionForStatus,
  normalizeTaskStatus,
  sourceLabel,
  taskAssignee,
} from "../../libs/utils/dashboardTaskUtils";

const LEGEND = [
  { label: "지연 위험(주의/위험)", color: "#EF4444" },
  { label: "업데이트 필요 (3일↑)", color: "#F59E0B" },
  { label: "정상 진행", color: "#ccc" },
];

const STATUS_CHANGE_LABEL: Record<"done" | "blocked", string> = {
  done: "완료",
  blocked: "블로커",
};

export function InProgressPage() {
  const { currentProjectId } = useAuth();
  const { data: tasks, loading, error, refetch } = useDashboardTasks(currentProjectId);
  const { data: progress } = useDashboardProgress(currentProjectId);
  const navigate = useNavigate();
  const onBack = () => navigate("/dashboard");
  const [dueDateTarget, setDueDateTarget] = useState<DashboardTaskDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const inProgressTasks = tasks.filter(task => normalizeTaskStatus(task.status) === "inprogress");
  const updateNeededCount = inProgressTasks.filter(task => (daysSince(task.updatedAt) ?? 0) >= 3).length;
  const riskPredictions = progress?.delayRisks.filter(risk => isDelayRisk(risk.result)) ?? [];
  const dangerTaskIds = new Set(riskPredictions.filter(risk => isDangerDelayRisk(risk.result)).map(risk => risk.taskId));
  const riskTaskIds = new Set(riskPredictions.map(risk => risk.taskId));
  const dangerCount = inProgressTasks.filter(task => dangerTaskIds.has(task.id)).length;
  const projectDDay = formatDDay(progress?.projectDeadline);
  const monitoringQuestion = `진행 중 업무 ${inProgressTasks.length}개를 점검해줘. 3일 이상 업데이트가 없는 업무는 ${updateNeededCount}개, 지연 위험 업무는 ${dangerCount}개, 프로젝트 마감은 ${projectDDay}야. 지금 확인할 업무와 권장 조치를 우선순위대로 알려줘. 출력은 3문장 이내로 해.`;

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

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="flex items-start justify-between">
        <div>
          <BackBtn onBack={onBack} />
          <h1 className="text-xl font-bold text-foreground">진행 중 업무 모니터링</h1>
          <p className="text-sm text-muted-foreground mt-0.5">현재 진행 중인 업무 상태를 파악하고 지연 가능성을 조기에 감지합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
          <button onClick={() => navigate("/board?openAdd=1")} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ background: "var(--primary)" }}>
            <Plus className="w-3.5 h-3.5" /> 업무 추가
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>}

      <div className="grid grid-cols-4 gap-3">
        <DetailStatCard label="진행 중" value={loading ? "..." : inProgressTasks.length} sub="활성 업무" color="#3B5BDB" icon={Clock} />
        <DetailStatCard label="업데이트 필요" value={loading ? "..." : updateNeededCount} sub="3일 이상 미업데이트" color="#F59E0B" icon={RefreshCw} />
        <DetailStatCard label="지연 위험" value={loading ? "..." : dangerCount} sub="고위험 업무(주의/위험)" color="#EF4444" icon={AlertTriangle} />
        <DetailStatCard label="D-Day" value={loading ? "..." : projectDDay} sub={formatDashboardDueDate(progress?.projectDeadline)} color="#7048E8" icon={Calendar} />
      </div>

      <AiInsightBox
        projectId={currentProjectId}
        prompt={monitoringQuestion}
        ready={!loading}
        fallbackText="오래 업데이트되지 않았거나 지연 위험이 높은 진행 중 업무의 점검 순서를 추천받을 수 있습니다."
      />

      <div className="flex items-center gap-4 px-1">
        {LEGEND.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {inProgressTasks.map((task, index) => {
          const member = taskAssignee(task, index);
          const statusDays = daysSince(task.updatedAt) ?? 0;
          const isRisk = riskTaskIds.has(task.id);
          const isDanger = dangerTaskIds.has(task.id);
          const isUpdateNeeded = statusDays >= 3;
          // LEGEND는 '지연 위험' 한 범주만 두고 있어(주의/위험 구분 없음), ML 예측이 주의든 위험이든
          // 모두 지연 위험(빨강)으로 묶는다 — 그래야 "AI 지연 위험" 배지(isRisk 기준)와 카드 색이 일치한다.
          const borderColor = isRisk ? "#EF4444" : isUpdateNeeded ? "#F59E0B" : "#ccc";
          const bgColor = isRisk ? "rgba(239,68,68,0.03)" : isUpdateNeeded ? "rgba(245,158,11,0.03)" : "#fff";

          return (
            <div key={task.id} className="rounded-xl shadow-sm overflow-hidden border" style={{ borderColor, borderLeftWidth: 4, background: bgColor }}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: member.color }}>
                      {member.initials}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{task.category ?? "미분류"}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{sourceLabel(task.sourceType)}</span>
                        {isRisk && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">AI 지연 위험</span>}
                      </div>
                      <div className="text-sm font-semibold text-foreground">{task.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{member.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">업데이트 {formatRelativeDate(task.updatedAt)}</span>
                    <span className="text-xs font-semibold bg-muted px-2 py-1 rounded-lg text-foreground">
                      마감 {formatDashboardDueDate(task.dueDate)}
                    </span>
                  </div>
                </div>

                {task.description && (
                  <div className="text-xs text-muted-foreground mb-3 px-3 py-2 rounded-lg bg-muted/60 border border-border">
                    {task.description}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">시작일</div>
                    <div className="text-xs font-medium text-foreground">{formatDashboardDueDate(task.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">마지막 업데이트</div>
                    <div className={`text-xs font-medium ${isUpdateNeeded ? "text-amber-600" : "text-foreground"}`}>{formatRelativeDate(task.updatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">마감일</div>
                    <div className="text-xs font-medium text-foreground">{formatDashboardDueDate(task.dueDate)}</div>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2 pt-3 border-t border-border">
                  <button
                    onClick={() => changeStatus(task.id, task.title, "done")}
                    disabled={pendingTaskId === task.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> 완료 처리
                  </button>
                  <button
                    onClick={() => changeStatus(task.id, task.title, "blocked")}
                    disabled={pendingTaskId === task.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> 블로커 전환
                  </button>
                  <button onClick={() => setDueDateTarget(task)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <Calendar className="w-3.5 h-3.5" /> 마감 조정
                  </button>
                  <button onClick={() => navigate("/board")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors">
                    <MessageSquare className="w-3.5 h-3.5" /> 댓글
                  </button>
                  <button onClick={() => openAIAssistant(`진행 중 업무 '${task.title}'을 점검해줘. 마지막 업데이트는 ${formatRelativeDate(task.updatedAt)}이고 ${statusDays}일째 현재 상태이며, 마감일은 ${formatDashboardDueDate(task.dueDate)}, 지연 예측은 ${isDanger ? "위험" : isRisk ? "주의" : "정상"}이야. 다음 액션을 추천해줘.`)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ml-auto transition-opacity hover:opacity-80" style={{ background: "rgba(112,72,232,0.12)", color: "#7048E8" }}>
                    <Sparkles className="w-3.5 h-3.5" /> AI에게 질문
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {(loading || inProgressTasks.length === 0) && (
          <div className="h-40 flex items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            {loading ? "데이터를 불러오는 중입니다" : "진행 중인 업무가 없습니다."}
          </div>
        )}
      </div>

      {dueDateTarget && currentProjectId != null && (
        <TaskDueDatePopup
          task={dueDateTarget}
          projectId={currentProjectId}
          onClose={() => setDueDateTarget(null)}
          onChanged={() => { setDueDateTarget(null); refetch(); }}
        />
      )}
    </div>
  );
}
