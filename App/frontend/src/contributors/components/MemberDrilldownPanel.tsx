import { useEffect, useState } from "react";
import { X, CheckCircle2, XCircle, Link2, FileText } from "lucide-react";
import { TaskStatusPill } from "../../board/components/TaskStatusPill";
import { PriorityBadge } from "../../board/components/PriorityBadge";
import {
  fetchAttendanceDetail,
  fetchMeeting,
  type MeetingAttendanceDetailDto,
  type MeetingAnalysisResponse,
} from "../../meetings/libs/utils/meetingAiApi";
import { fetchChecklist } from "../../board/libs/utils/checklistApi";
import { fetchTaskResult, type TaskResultDto } from "../../board/libs/utils/taskResultApi";
import type { ChecklistItem, Task, TaskStatus } from "../../board/libs/types/task";
import type { ContributionMemberScoreDto } from "../libs/utils/contributorsApi";

const STATUS_ORDER: TaskStatus[] = ["todo", "inprogress", "blocked", "done"];

export interface WorkloadEvidenceInput {
  anomalyType: string;
  taskCountActiveRel: number;
  // "배정량 불균형" 문구 전용: 애초에 배정받은 전체 업무 수의 팀 평균 대비 비율.
  // taskCountActiveRel(진행중 업무 비율)은 배정된 업무를 전부 끝낸 사람도 0이 되므로
  // 이 근거 문구에는 이 필드를 쓴다(백엔드 anomaly_type 판정과 동일한 기준).
  taskCountTotalRel: number;
  difficultyAvgRel: number;
  overdueCount: number;
  completionRate: number;
  // anomaly_type 판정에 실제로 쓰인 팀 평균 완료율(0~1). 없으면(팀 평균을
  // 아직 못 불러온 경우) "팀 평균보다 높음/낮음" 같은 단정적 비교 문구를 만들지 않는다.
  teamMeanCompletionRate: number | null;
}

// LLM 미개입 결정론적 문장 생성기 — 근거가 이미 계산된 수치이므로 자연어 생성에
// 불확실성을 끌어들일 이유가 없다.
export function buildWorkloadEvidenceSentences(input: WorkloadEvidenceInput): string[] {
  const sentences: string[] = [];
  const activeMultiple = input.taskCountActiveRel.toFixed(1);
  const totalMultiple = input.taskCountTotalRel.toFixed(1);
  const difficultyMultiple = input.difficultyAvgRel.toFixed(1);
  const completionPct = Math.round(input.completionRate * 100);
  // 팀 평균값이 있을 때만 "팀 평균 N%보다 낮음/높음"처럼 실측 비교를 보여준다.
  // 팀 평균을 모르면서 방향만 단정하면 심사 근거를 오도할 수 있다(리뷰 지적사항).
  const teamMeanPct = input.teamMeanCompletionRate != null ? Math.round(input.teamMeanCompletionRate * 100) : null;
  const completionVsTeam = (comparison: "낮습니다" | "높습니다") =>
    teamMeanPct != null
      ? `업무 완료율은 ${completionPct}%로 팀 평균(${teamMeanPct}%)보다 ${comparison}.`
      : `업무 완료율은 ${completionPct}%입니다. (팀 평균값을 불러오지 못해 비교는 표시하지 않습니다.)`;

  if (input.anomalyType === "과부하 의심") {
    if (input.taskCountActiveRel > 1.0) {
      sentences.push(`진행 중인 업무가 팀 평균 대비 ${activeMultiple}배 많습니다.`);
    }
    if (input.difficultyAvgRel > 1.0) {
      sentences.push(`담당 업무의 평균 난이도가 팀 평균보다 ${difficultyMultiple}배 높습니다.`);
    }
    if (input.overdueCount > 0) {
      sentences.push(`마감이 지난 업무가 ${input.overdueCount}건 있습니다.`);
    }
    sentences.push(completionVsTeam("낮습니다"));
  } else if (input.anomalyType === "배정량 불균형") {
    sentences.push(`배정된 업무 자체가 팀 평균 대비 ${totalMultiple}배 적습니다.`);
    sentences.push(completionVsTeam("높습니다"));
  } else {
    sentences.push("팀 평균과 비교했을 때 업무량·난이도·완료율 모두 특별한 편중이 없습니다.");
  }
  return sentences;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TaskEvidenceDetailsProps {
  taskId: string;
  projectId: number;
}

// 심사자용 읽기 전용 업무 근거 — 체크리스트 토글/작업 내용 저장/링크·파일 추가 삭제는 제공하지 않는다.
function TaskEvidenceDetails({ taskId, projectId }: TaskEvidenceDetailsProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistStatus, setChecklistStatus] = useState<"loading" | "ready" | "error">("loading");
  const [taskResult, setTaskResult] = useState<TaskResultDto | null>(null);
  const [resultStatus, setResultStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setChecklistStatus("loading");
    fetchChecklist(taskId, projectId)
      .then((items) => { setChecklist(items); setChecklistStatus("ready"); })
      .catch(() => setChecklistStatus("error"));

    setResultStatus("loading");
    fetchTaskResult(taskId, projectId)
      .then((result) => { setTaskResult(result); setResultStatus("ready"); })
      .catch(() => setResultStatus("error"));
  }, [taskId, projectId]);

  return (
    <div className="mt-2 ml-3 pl-3 border-l-2 border-border space-y-3">
      <div>
        <div className="text-[10px] font-bold text-muted-foreground mb-1">체크리스트</div>
        {checklistStatus === "loading" && <p className="text-[11px] text-muted-foreground">불러오는 중...</p>}
        {checklistStatus === "error" && <p className="text-[11px] text-red-600">체크리스트를 불러오지 못했습니다.</p>}
        {checklistStatus === "ready" && checklist.length === 0 && (
          <p className="text-[11px] text-muted-foreground">체크리스트가 없습니다.</p>
        )}
        {checklistStatus === "ready" && checklist.map((item) => (
          <div key={item.id} className="flex items-center gap-1.5 py-0.5">
            {item.done ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <span className={`text-[11px] ${item.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10px] font-bold text-muted-foreground mb-1">작업 내용</div>
        {resultStatus === "loading" && <p className="text-[11px] text-muted-foreground">불러오는 중...</p>}
        {resultStatus === "error" && <p className="text-[11px] text-red-600">작업 내용을 불러오지 못했습니다.</p>}
        {resultStatus === "ready" && taskResult && (
          <>
            {taskResult.content ? (
              <p className="text-[11px] text-foreground whitespace-pre-wrap">{taskResult.content}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">작성된 작업 내용이 없습니다.</p>
            )}
            {taskResult.links.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {taskResult.links.map((link) => (
                  <div key={link.id} className="flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-foreground truncate">{link.title}</span>
                  </div>
                ))}
              </div>
            )}
            {taskResult.files.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {taskResult.files.map((file) => (
                  <div key={file.id} className="flex items-center gap-1.5">
                    <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-foreground truncate">{file.fileName}</span>
                    <span className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface MeetingEvidenceDetailsProps {
  projectId: number;
  meetingId: string;
}

const MEETING_STATUS_MESSAGE: Record<string, string> = {
  PROCESSING: "AI 분석이 아직 진행 중입니다.",
  FAILED: "AI 분석에 실패했습니다.",
};

// 심사자용 읽기 전용 회의 근거 — 회의록 AI To-do를 업무로 등록하는 기능은 제공하지 않는다.
function MeetingEvidenceDetails({ projectId, meetingId }: MeetingEvidenceDetailsProps) {
  const [meeting, setMeeting] = useState<MeetingAnalysisResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setStatus("loading");
    fetchMeeting(String(projectId), meetingId)
      .then((result) => { setMeeting(result); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, [projectId, meetingId]);

  if (status === "loading") return <p className="mt-2 ml-3 text-[11px] text-muted-foreground">불러오는 중...</p>;
  if (status === "error") return <p className="mt-2 ml-3 text-[11px] text-red-600">회의 상세를 불러오지 못했습니다.</p>;
  if (!meeting || !meeting.analysis) {
    const message = meeting ? (MEETING_STATUS_MESSAGE[meeting.status] ?? "분석 결과가 없습니다.") : "분석 결과가 없습니다.";
    return <p className="mt-2 ml-3 text-[11px] text-muted-foreground">{message}</p>;
  }

  const { analysis } = meeting;
  return (
    <div className="mt-2 ml-3 pl-3 border-l-2 border-border space-y-3">
      <div>
        <div className="text-[10px] font-bold text-muted-foreground mb-1">AI 요약</div>
        <p className="text-[11px] text-foreground whitespace-pre-wrap">{analysis.summary}</p>
      </div>
      {analysis.decisions.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-muted-foreground mb-1">결정사항</div>
          {analysis.decisions.map((decision, i) => (
            <p key={i} className="text-[11px] text-foreground"><span aria-hidden="true">· </span><span>{decision}</span></p>
          ))}
        </div>
      )}
      {analysis.todos.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-muted-foreground mb-1">To-do 후보</div>
          {analysis.todos.map((todo, i) => (
            <p key={i} className="text-[11px] text-foreground"><span aria-hidden="true">· </span><span>{todo.title}</span></p>
          ))}
        </div>
      )}
      {analysis.risks.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-muted-foreground mb-1">리스크</div>
          {analysis.risks.map((risk, i) => (
            <p key={i} className="text-[11px] text-foreground"><span aria-hidden="true">· </span><span>{risk}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

const ANOMALY_BADGE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  "과부하 의심": { label: "과부하 의심", color: "#DC2626", bg: "#FEF2F2" },
  // "저활동 의심"이 아니라 중립적 라벨을 쓴다: 배정량이 팀 평균보다 적다는 관찰 사실은
  // 맞지만, 완료율이 높은 사람에게도 뜨므로(예: 배정받은 일을 전부 끝낸 경우) 태만을
  // 단정하는 표현은 피하고 심사자가 직접 판단하도록 한다.
  "배정량 불균형": { label: "배정량 불균형", color: "#D97706", bg: "#FFFBEB" },
};
const DEFAULT_ANOMALY_BADGE = { label: "정상", color: "#64748B", bg: "#F1F5F9" };

interface WorkloadEvidenceDetailsProps {
  workloadEvidence: ContributionMemberScoreDto | undefined;
  // anomaly_type 판정에 쓰인 실제 팀 평균 완료율(0~1). ContributorsView가
  // fetchContributionScore()의 team_mean_completion을 그대로 내려준다.
  teamMeanCompletion: number | null;
}

// 신규 fetch 없음 — ContributorsView가 페이지 진입 시 이미 로드해 둔 contributionByMemberId를
// 그대로 prop으로 받아 렌더링한다(업무/회의 모드와 달리 로딩 상태가 없다).
function WorkloadEvidenceDetails({ workloadEvidence, teamMeanCompletion }: WorkloadEvidenceDetailsProps) {
  if (!workloadEvidence) {
    return <p className="p-4 text-xs text-muted-foreground">편중도 근거를 불러오지 못했습니다.</p>;
  }

  // taskCountActiveRel/difficultyAvgRel/overdueCount는 TS 타입상 number지만, Spring
  // ContributionMemberScoreDto의 실제 필드는 boxed Double/Integer라 구버전 FastAPI가
  // 이 신규 필드를 응답에 안 담아 보내면(혼합 배포 롤백 등) 런타임에 null이 올 수 있다.
  // toFixed() 등에서 크래시하지 않도록 수치 필드가 전부 유효한 숫자인지 먼저 확인한다.
  const numericFields = [
    workloadEvidence.taskCountActiveRel,
    workloadEvidence.taskCountTotalRel,
    workloadEvidence.difficultyAvgRel,
    workloadEvidence.overdueCount,
    workloadEvidence.taskComponent,
  ];
  if (numericFields.some((v) => v == null || Number.isNaN(v))) {
    return <p className="p-4 text-xs text-muted-foreground">편중도 근거 데이터가 불완전합니다. 새로고침 후 다시 시도해주세요.</p>;
  }

  const badge = ANOMALY_BADGE_STYLE[workloadEvidence.anomalyType] ?? DEFAULT_ANOMALY_BADGE;
  const sentences = buildWorkloadEvidenceSentences({
    anomalyType: workloadEvidence.anomalyType,
    taskCountActiveRel: workloadEvidence.taskCountActiveRel,
    taskCountTotalRel: workloadEvidence.taskCountTotalRel,
    difficultyAvgRel: workloadEvidence.difficultyAvgRel,
    overdueCount: workloadEvidence.overdueCount,
    completionRate: workloadEvidence.taskComponent / 100,
    teamMeanCompletionRate: teamMeanCompletion,
  });

  return (
    <div className="p-4 space-y-3">
      <span
        className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full"
        style={{ color: badge.color, background: badge.bg }}
      >
        {badge.label}
      </span>
      <div className="space-y-1.5">
        {sentences.map((sentence, i) => (
          <p key={i} className="text-xs text-foreground"><span aria-hidden="true">· </span><span>{sentence}</span></p>
        ))}
      </div>
    </div>
  );
}

interface MemberDrilldownPanelProps {
  mode: "tasks" | "meetings" | "workload";
  memberName: string;
  memberTasks: Task[];
  projectId: number;
  userId: number;
  onClose: () => void;
  workloadEvidence?: ContributionMemberScoreDto;
  teamMeanCompletion?: number | null;
}

export function MemberDrilldownPanel({ mode, memberName, memberTasks, projectId, userId, onClose, workloadEvidence, teamMeanCompletion = null }: MemberDrilldownPanelProps) {
  const [attendance, setAttendance] = useState<MeetingAttendanceDetailDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  useEffect(() => {
    // 이 패널은 항상 모달 배경(오버레이) 클릭으로만 닫히므로, 열려 있는 동안 다른
    // 멤버/모드로 props가 바뀌는 경우가 없어 stale-response 경합이 발생하지 않는다.
    // 패널이 비모달로 바뀌거나 패널 내 이전/다음 탐색 기능이 추가되면 ignore 플래그가 필요하다.
    if (mode !== "meetings") return;
    setStatus("loading");
    fetchAttendanceDetail(String(projectId), userId)
      .then((result) => {
        setAttendance(result);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [mode, projectId, userId]);

  const groupedTasks = STATUS_ORDER.map((statusKey) => ({
    statusKey,
    tasks: memberTasks.filter((task) => task.status === statusKey),
  }));

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-xl z-50 overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">
            {memberName} · {mode === "tasks" ? "업무 수행 내역" : mode === "meetings" ? "회의 참여 내역" : "업무 편중도 근거"}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {mode === "tasks" ? (
          <div className="p-4 space-y-5">
            {groupedTasks.map(({ statusKey, tasks }) => (
              <div key={statusKey}>
                <div className="flex items-center gap-2 mb-2">
                  <TaskStatusPill status={statusKey} />
                  <span className="text-[11px] text-muted-foreground">{tasks.length}건</span>
                </div>
                {tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">해당 상태의 업무가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div key={task.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTaskId((cur) => (cur === task.id ? null : task.id))}
                          className="w-full flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted transition-colors"
                        >
                          <span className="text-xs font-medium text-foreground truncate">{task.title}</span>
                          <PriorityBadge priority={task.priority} />
                        </button>
                        {selectedTaskId === task.id && (
                          <TaskEvidenceDetails taskId={task.id} projectId={projectId} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {memberTasks.length === 0 && (
              <p className="text-xs text-muted-foreground">표시할 업무가 없습니다.</p>
            )}
          </div>
        ) : mode === "meetings" ? (
          <div className="p-4">
            {status === "loading" && <p className="text-xs text-muted-foreground">불러오는 중...</p>}
            {status === "error" && <p className="text-xs text-red-600">회의 참여 내역을 불러오지 못했습니다.</p>}
            {status === "ready" && (
              attendance.length === 0 ? (
                <p className="text-xs text-muted-foreground">등록된 회의가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {attendance.map((meeting) => (
                    <div key={meeting.meetingId}>
                      <button
                        type="button"
                        onClick={() => setSelectedMeetingId((cur) => (cur === meeting.meetingId ? null : meeting.meetingId))}
                        className="w-full flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted transition-colors"
                      >
                        <div className="min-w-0 text-left">
                          <div className="text-xs font-medium text-foreground truncate">{meeting.title}</div>
                          <div className="text-[11px] text-muted-foreground">{meeting.meetingDate ?? "날짜 미정"}</div>
                        </div>
                        {meeting.attended ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 참석
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-red-500 shrink-0">
                            <XCircle className="w-3.5 h-3.5" /> 결석
                          </span>
                        )}
                      </button>
                      {selectedMeetingId === meeting.meetingId && (
                        <MeetingEvidenceDetails projectId={projectId} meetingId={meeting.meetingId} />
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        ) : (
          <WorkloadEvidenceDetails workloadEvidence={workloadEvidence} teamMeanCompletion={teamMeanCompletion} />
        )}
      </div>
    </>
  );
}
