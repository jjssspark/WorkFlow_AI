import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CatTag } from "../../board/components/CatTag";
import { PriorityBadge } from "../../board/components/PriorityBadge";
import { getCat } from "../../board/libs/utils/taskService";
import { getStoredMeetings, getSavedMeetings, saveSavedMeetings, getStoredTasks, saveStoredTasks, saveStoredMeetings, getDeletedMeetingIds, markDeletedMeeting } from "../../board/libs/utils/localStore";
import { addActivity } from "../../board/libs/utils/activityStore";
import { CATEGORIES } from "../../board/libs/mock/tasks";
import type { Meeting, UploadFlow, UploadType, GenTodo, SavedMeetingRecord } from "../libs/types/meeting";
import type { CatId, Priority, Task } from "../../board/libs/types/task";
import { analyzeMeeting, confirmMeetingSave, deleteMeeting, fetchMeeting, fetchMeetings, registerMeetingTasks, retryMeetingAnalysis } from "../libs/utils/meetingAiApi";
import { MeetingEditPanel } from "../components/MeetingEditPanel";
import type { MeetingAiResult } from "../libs/types/meetingAiTypes";
import { deleteTask, DEMO_PROJECT_ID } from "../../board/libs/utils/taskApi";
import { useAuth } from "../../global/hooks/useAuth";
import type { ProjectRoleKo } from "../../global/api/authTypes";
import { ApiRequestError } from "../../global/api/apiClient";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  LayoutDashboard,
  Columns3,
  FileAudio,
  Sparkles,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Calendar,
  Upload,
  Circle,
  CheckCheck,
  FileText,
  Mic,
  Eye,
  CheckSquare,
  ArrowRight,
  ArrowLeft,
  Check,
  Users,
  ListChecks,
  Radio,
  Trash2,
  Loader2,
} from "lucide-react";

export type CurrentUserRole = "leader" | "member" | "reviewer";

export function deriveCurrentUserRole(role: ProjectRoleKo | null | undefined): CurrentUserRole {
  if (role === "팀장") return "leader";
  if (role === "심사자") return "reviewer";
  return "member";
}

const PARTICIPANT_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EC4899", "#0EA5E9"];
const MEETING_STATUS_POLL_INTERVAL_MS = 2000;
const MEETING_STATUS_MAX_POLL_ATTEMPTS = 60;
const MEETING_STATUS_MAX_NETWORK_FAILURES = 5;

type AnalysisPhase = "idle" | "uploading" | "queued" | "analyzing" | "finalizing";

const ANALYSIS_PHASE_COPY: Record<AnalysisPhase, { title: string; message: string; badge: string }> = {
  idle: {
    title: "AI 분석 준비 중",
    message: "회의록 분석을 시작할 준비를 하고 있습니다.",
    badge: "준비 중",
  },
  uploading: {
    title: "회의록 업로드 중",
    message: "파일을 서버에 보내고 분석 작업을 생성하고 있습니다.",
    badge: "서버 요청 처리 중",
  },
  queued: {
    title: "분석 작업 접수 완료",
    message: "서버가 회의록을 저장했고 백그라운드 분석 작업을 준비하고 있습니다.",
    badge: "상태 확인 대기 중",
  },
  analyzing: {
    title: "AI 분석 진행 중",
    message: "서버의 PROCESSING 상태를 확인하면서 AI 분석 결과를 기다리고 있습니다.",
    badge: "AI 분석 중",
  },
  finalizing: {
    title: "결과 정리 중",
    message: "분석 결과를 저장하고 화면에 표시할 준비를 하고 있습니다.",
    badge: "결과 저장 중",
  },
};

const getStageIndexFromProgress = (progress: number, stageCount: number) => {
  if (stageCount <= 1) return 0;
  if (progress >= 100) return stageCount - 1;
  return Math.min(Math.floor(progress / (100 / stageCount)), stageCount - 1);
};

const getProcessingProgressTarget = (attempts: number) => Math.min(86, 34 + attempts * 5);

const formatElapsed = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${rest}초` : `${rest}초`;
};

const groupTodosByAssignee = (list: GenTodo[], resolveAssignee: (todo: GenTodo) => string): GenTodo[] => {
  const UNASSIGNED_KEY = "__unassigned__";
  const order: string[] = [];
  const groups = new Map<string, GenTodo[]>();
  list.forEach(todo => {
    const key = resolveAssignee(todo) || UNASSIGNED_KEY;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(todo);
  });
  const assignedOrder = order.filter(key => key !== UNASSIGNED_KEY);
  const finalOrder = groups.has(UNASSIGNED_KEY) ? [...assignedOrder, UNASSIGNED_KEY] : assignedOrder;
  return finalOrder.flatMap(key => groups.get(key)!);
};

const buildTodoRegistrationKey = (meetingIdentifier: string, title: string, assignee: string, dueDate: string): string =>
  `${meetingIdentifier.trim()}::${title.trim()}::${assignee}::${dueDate.trim()}`;

const isServerMeetingId = (meetingId: string): boolean => /^\d+$/.test(meetingId);

// 회의 상세 화면(meeting.todos)의 "이름: 업무내용 (마감일)" 문자열 포맷을 파싱한다.
const parseMeetingTodoLine = (line: string): { assigneeName: string; title: string; dueDate: string } => {
  const separatorIndex = line.indexOf(": ");
  if (separatorIndex === -1) return { assigneeName: "미배정", title: line, dueDate: "" };
  const assigneeName = line.slice(0, separatorIndex).trim() || "미배정";
  const rest = line.slice(separatorIndex + 2).trim();
  const dueMatch = rest.match(/\s\(([\d.]+)\)$/);
  const dueDate = dueMatch ? dueMatch[1] : "";
  const title = dueMatch ? rest.slice(0, dueMatch.index).trim() : rest;
  return { assigneeName, title, dueDate };
};

const groupMeetingTodoLines = (lines: string[]): string[] => {
  const UNASSIGNED = "미배정";
  const order: string[] = [];
  const groups = new Map<string, string[]>();
  lines.forEach(line => {
    const key = parseMeetingTodoLine(line).assigneeName || UNASSIGNED;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(line);
  });
  const assignedOrder = order.filter(key => key !== UNASSIGNED);
  const finalOrder = groups.has(UNASSIGNED) ? [...assignedOrder, UNASSIGNED] : assignedOrder;
  return finalOrder.flatMap(key => groups.get(key)!);
};

const DOCUMENT_ANALYZE_STAGES = [
  "파일 업로드 완료", "문서 텍스트 추출 중",
  "회의 내용 분석 중", "핵심 결정사항 추출 중",
  "업무 자동 생성 중", "역할 분배 생성 중",
];

const AUDIO_ANALYZE_STAGES = [
  "파일 업로드 완료", "음성 변환 중", "텍스트 정리 중",
  "회의 내용 분석 중", "핵심 결정사항 추출 중",
  "업무 자동 생성 중", "역할 분배 생성 중",
];

const getAnalyzeStages = (type: UploadType): string[] => {
  if (type === "audio") return AUDIO_ANALYZE_STAGES;
  return DOCUMENT_ANALYZE_STAGES;
};

const AI_CATEGORY_TO_BOARD: Record<string, CatId> = {
  PLANNING: "planning",
  RESEARCH: "research",
  UX: "ux-ui",
  UI: "ux-ui",
  DESIGN: "design",
  FRONTEND: "frontend",
  BACKEND: "backend",
  AI: "ai-ml",
  ML: "ai-ml",
  STT: "ai-ml",
  RAG: "ai-ml",
  DATA: "data",
  DATABASE: "db",
  DB: "db",
  DEVOPS: "devops",
  GITHUB: "github",
  DASHBOARD: "frontend",
  DOCUMENT: "docs",
  DOCS: "docs",
  PRESENTATION: "presentation",
  QA: "qa",
  SECURITY: "security",
  DELIVERABLE: "deliverable",
  OPERATION: "operation",
  ETC: "other",
};

const mapAiPriority = (priority: string): Priority => {
  if (priority === "HIGH") return "high";
  if (priority === "LOW") return "low";
  return "medium";
};

const formatAiDueDate = (dueDate: string | null) => {
  if (!dueDate) return "미정";
  const [, month, day] = dueDate.split("-");
  return month && day ? `${month}.${day}` : dueDate;
};

// 담당자는 서버(MeetingAnalysisPersistence)가 참석자/프로젝트 멤버 검증을 마친 assignee_id를 그대로 신뢰한다.
// 후보 이름(assignee_candidate)만 보고 프론트에서 임의로 매칭하지 않는다 — null이면 반드시 미배정으로 남는다.
export const buildGeneratedTodos = (result: MeetingAiResult): GenTodo[] =>
  result.todos.map((todo, index) => {
    const assignee = todo.assignee_id ?? "";
    return {
      id: `GT-${String(index + 1).padStart(2, "0")}`,
      title: todo.title,
      desc: todo.description,
      category: AI_CATEGORY_TO_BOARD[todo.category.toUpperCase()] ?? "other",
      assignee,
      dueDate: formatAiDueDate(todo.due_date),
      priority: mapAiPriority(todo.priority),
      basis: todo.evidence_text?.trim()
        ? todo.evidence_text
        : todo.assignee_candidate
          ? `회의록 후보 담당자: ${todo.assignee_candidate}`
          : "회의록 AI 분석 결과",
      assigned: Boolean(assignee),
      source: "MEETING_AI" as const,
    };
  });

const buildRiskCards = (risks: string[]) =>
  risks.map((text, index) => ({
    level: index === 0 ? "high" : "medium",
    text,
    suggestion: index === 0
      ? "팀장 검토 후 담당자와 마감일을 먼저 확정하는 것을 권장합니다."
      : "관련 업무의 우선순위와 일정 여유를 재점검하세요.",
  }));

const getTodayIsoDate = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const stripFileExtension = (fileName: string) => fileName.replace(/\.[^/.]+$/, "");
const TEXT_PREVIEW_EXTENSIONS = new Set(["txt", "md", "csv", "json", "log"]);
const getFileExtension = (fileName: string) => (fileName.split(".").pop() ?? "").toLowerCase();

// UTF-8로 우선 디코딩하고, 깨진 바이트가 있으면(주로 EUC-KR/CP949로 저장된 옛 한글 문서) euc-kr로 재시도한다.
const decodeTextFile = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
};

// ZIP 스트리밍(data descriptor) 방식으로 쓰인 항목은 로컬 헤더의 compressedSize가 0이라
// 실제 길이를 알 수 없다. 다음 데이터 디스크립터/로컬 헤더/중앙 디렉터리 시그니처가
// 나오는 지점까지를 압축 데이터로 간주해 역산한다.
const findStreamedEntryLength = (bytes: Uint8Array, view: DataView, dataStart: number): number => {
  for (let i = dataStart; i < bytes.length - 4; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x08074b50 || sig === 0x04034b50 || sig === 0x02014b50) return i - dataStart;
  }
  return bytes.length - dataStart;
};

// 외부 라이브러리 없이 docx(zip) 안의 word/document.xml만 추출해 태그를 제거한 순수 텍스트로 변환한다.
const extractDocxText = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (view.getUint32(offset, true) !== 0x04034b50) { offset++; continue; }
    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const headerSize = view.getUint32(offset + 18, true);
    const usesDataDescriptor = (flags & 0x0008) !== 0 && headerSize === 0;
    const compressedSize = usesDataDescriptor ? findStreamedEntryLength(bytes, view, dataStart) : headerSize;
    if (name === "word/document.xml") {
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      let xmlBytes: Uint8Array;
      if (compressionMethod === 0) {
        xmlBytes = compressed;
      } else {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      const xml = new TextDecoder("utf-8").decode(xmlBytes);
      return xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    offset = dataStart + compressedSize;
  }
  throw new Error("document.xml not found");
};
const formatDisplayDate = (date: string) => (date || getTodayIsoDate()).replace(/-/g, ".");
// 마감일 입력을 "MM.DD" 형식으로 자동 포맷한다 — 숫자만 받아 2자리 입력 시 자동으로 "." 삽입, 4자리 초과 무시.
const formatMMDDInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
};

const formatDateTime = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  const timePart = d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} ${timePart}`;
};

const buildMeetingFromAnalysisResponse = (
  response: Awaited<ReturnType<typeof fetchMeeting>>,
  fallback: Partial<Meeting> = {}
): Meeting => {
  const analysis = response.analysis;
  if (!analysis) {
    return {
      id: response.meetingId,
      title: fallback.title ?? response.fileName ?? "회의록",
      date: fallback.date ?? "",
      duration: response.status === "FAILED" ? "분석 실패" : "분석 중",
      status: response.status === "COMPLETED" ? "processed" : response.status === "FAILED" ? "failed" : "processing",
      fileName: response.fileName ?? fallback.fileName,
      uploadedAt: fallback.uploadedAt,
      analyzedAt: fallback.analyzedAt,
    };
  }
  const source = response.analysisSource === "FASTAPI" ? "fastapi" : "spring-fallback";
  return {
    id: response.meetingId,
    title: analysis.meeting_meta.title || fallback.title || response.fileName || "회의록",
    date: formatDisplayDate(analysis.meeting_meta.meeting_date || fallback.date || getTodayIsoDate()),
    duration: "분석 완료",
    status: "processed",
    summary: analysis.summary,
    decisions: analysis.decisions,
    todos: analysis.todos.map(todo => {
      // 서버가 검증한 assignee_id가 있을 때만 후보 이름을 표시한다. assignee_id가 없으면
      // assignee_candidate(AI가 언급만 추출한 이름)가 있어도 반드시 "미배정"으로 표시한다.
      const assignee = todo.assignee_id ? (todo.assignee_candidate || "담당자") : "미배정";
      const due = todo.due_date ? ` (${todo.due_date.slice(5).replace("-", ".")})` : "";
      return `${assignee}: ${todo.title}${due}`;
    }),
    risks: analysis.risks,
    analysisSource: source,
    fileName: response.fileName ?? fallback.fileName,
    uploadedAt: fallback.uploadedAt,
    analyzedAt: fallback.analyzedAt ?? new Date().toISOString(),
  };
};

export function MeetingsView() {
  const { currentProjectId, user, currentProject } = useAuth();
  const currentUserRole = deriveCurrentUserRole(currentProject?.role);
  const projectId = String(currentProjectId ?? DEMO_PROJECT_ID);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meetings, setMeetings] = useState<Meeting[]>(() => getStoredMeetings(projectId));
  const [selected, setSelected] = useState<string|null>(() => getStoredMeetings(projectId)[0]?.id ?? null);
  const [homeTab, setHomeTab] = useState<"analyze" | "saved">("analyze");
  const [uploadFlow, setUploadFlow] = useState<UploadFlow>(null);
  const [uploadType, setUploadType] = useState<UploadType>(null);
  const [modalStep, setModalStep] = useState(0);
  const [analyzeStage, setAnalyzeStage] = useState(0);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeProgressTarget, setAnalyzeProgressTarget] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const [pollAttemptCount, setPollAttemptCount] = useState(0);
  const [analysisRequestPending, setAnalysisRequestPending] = useState(false);
  const [meetTitle, setMeetTitle] = useState("");
  const [meetDate, setMeetDate] = useState(getTodayIsoDate());
  const [meetKind, setMeetKind] = useState("정기회의");
  const [partIds, setPartIds] = useState<string[]>([]);
  const [projectMembers, setProjectMembers] = useState<MemberResponse[]>([]);
  const [analysisResult, setAnalysisResult] = useState<MeetingAiResult | null>(null);
  const [selTodos, setSelTodos] = useState<string[]>([]);
  const [todoAssignees, setTodoAssignees] = useState<Record<string,string>>({});
  const [todoDueDates, setTodoDueDates] = useState<Record<string,string>>({});
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [analysisSource, setAnalysisSource] = useState<"fastapi"|"spring-fallback"|null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"summary"|"todos"|"risks">("summary");
  const [manualTodos, setManualTodos] = useState<GenTodo[]>([]);
  const [showAddTodo, setShowAddTodo] = useState(false);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoDesc, setNewTodoDesc] = useState("");
  const [newTodoCategory, setNewTodoCategory] = useState<CatId>("other");
  const [newTodoAssignee, setNewTodoAssignee] = useState("");
  const [newTodoDueDate, setNewTodoDueDate] = useState("");
  const [newTodoPriority, setNewTodoPriority] = useState<Priority>("medium");
  const [newTodoError, setNewTodoError] = useState<string | null>(null);
  const [saveMeetingMessage, setSaveMeetingMessage] = useState<string | null>(null);
  const [saveMeetingError, setSaveMeetingError] = useState<string | null>(null);
  const [originalViewMessage, setOriginalViewMessage] = useState<string | null>(null);
  const [originalPreview, setOriginalPreview] = useState<{ kind: "text"; content: string; fileName: string } | { kind: "unsupported"; fileName: string } | null>(null);
  const [pdfExportMessage, setPdfExportMessage] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);
  const [isRegisteringTasks, setIsRegisteringTasks] = useState(false);
  const [meetingListError, setMeetingListError] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deletingMeetingId, setDeletingMeetingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null);
  const [confirmReregister, setConfirmReregister] = useState<(() => void) | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editingTranscript, setEditingTranscript] = useState("");
  const [viewingOriginalMeeting, setViewingOriginalMeeting] = useState<{ title: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollSessionRef = useRef(0);
  const deepLinkHandledIdRef = useRef<string | null>(null);
  const analyzeStages = getAnalyzeStages(uploadType);
  const canAddManualTodo = currentUserRole === "leader";

  // 실제 서버 처리 흐름에 맞춘 진행률 표시:
  // 업로드 요청 → 서버 PROCESSING 폴링 → 완료/실패 응답 순서로 목표 진행률만 올린다.
  useEffect(() => {
    if (uploadFlow !== "analyzing") return;
    const iv = setInterval(() => {
      setAnalyzeProgress(prev => {
        if (prev >= analyzeProgressTarget) return prev;
        const remaining = analyzeProgressTarget - prev;
        return Math.min(analyzeProgressTarget, prev + Math.max(1, Math.ceil(remaining * 0.25)));
      });
    }, 350);
    return () => clearInterval(iv);
  }, [uploadFlow, analyzeProgressTarget]);

  useEffect(() => {
    setAnalyzeStage(getStageIndexFromProgress(analyzeProgress, analyzeStages.length));
  }, [analyzeProgress, analyzeStages.length]);

  useEffect(() => {
    if (uploadFlow !== "analyzing") return;
    const startedAt = Date.now();
    setAnalysisElapsedSeconds(0);
    const iv = setInterval(() => {
      setAnalysisElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [uploadFlow]);

  const stopPolling = () => {
    pollSessionRef.current += 1;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (resultTransitionTimeoutRef.current) {
      clearTimeout(resultTransitionTimeoutRef.current);
      resultTransitionTimeoutRef.current = null;
    }
  };

  // "analyzing" 화면을 벗어나면(완료/실패/사용자 이탈) polling을 중단한다.
  useEffect(() => {
    if (uploadFlow !== "analyzing") {
      stopPolling();
      setAnalysisRequestPending(false);
      setAnalysisPhase("idle");
    }
  }, [uploadFlow]);

  // unmount 시 polling 정리
  useEffect(() => () => stopPolling(), []);

  // meetingId를 대상으로 서버 분석 상태를 2초 간격으로 조회해 completed/failed를 반영한다.
  const pollMeetingStatus = (meetingId: string, title: string, uploadedAt: string) => {
    stopPolling();
    const pollSessionId = pollSessionRef.current + 1;
    pollSessionRef.current = pollSessionId;
    let attempts = 0;
    let consecutiveNetworkFailures = 0;
    setPollAttemptCount(0);
    setAnalysisPhase("queued");
    setAnalyzeProgressTarget(prev => Math.max(prev, 28));

    const finishToResults = (applyResult: () => void) => {
      setAnalysisPhase("finalizing");
      setAnalyzeProgressTarget(100);
      setAnalyzeProgress(100);
      stopPolling();
      resultTransitionTimeoutRef.current = setTimeout(() => {
        resultTransitionTimeoutRef.current = null;
        applyResult();
      }, 550);
    };

    const checkStatus = () => {
      if (pollSessionRef.current !== pollSessionId) return;
      attempts += 1;
      setPollAttemptCount(attempts);
      if (attempts > MEETING_STATUS_MAX_POLL_ATTEMPTS) {
        stopPolling();
        setAnalysisResult(null);
        setSelTodos([]);
        setAnalysisSource(null);
        setAnalysisError("분석 시간이 초과되었습니다. 잠시 후 재시도해주세요.");
        setUploadFlow("results");
        return;
      }

      fetchMeeting(projectId, meetingId).then(response => {
        if (pollSessionRef.current !== pollSessionId) return;
        consecutiveNetworkFailures = 0;
        if (response.status === "PROCESSING") {
          setAnalysisPhase("analyzing");
          setAnalyzeProgressTarget(getProcessingProgressTarget(attempts));
          return;
        }
        if (response.status === "COMPLETED" && response.analysis) {
          const apiTodos = buildGeneratedTodos(response.analysis);
          const source = response.analysisSource === "FASTAPI" ? "fastapi" : "spring-fallback";
          const analyzedMeeting = buildMeetingFromAnalysisResponse(response, {
            title,
            date: meetDate,
            fileName: selectedFile?.name,
            uploadedAt,
          });
          finishToResults(() => {
            setAnalysisResult(response.analysis);
            setSelTodos(apiTodos.map(t => t.id));
            setAnalysisSource(source);
            setMeetings(prev => {
              const next = [analyzedMeeting, ...prev.filter(item => item.id !== analyzedMeeting.id)];
              saveStoredMeetings(next, projectId);
              return next;
            });
            setSelected(analyzedMeeting.id);
            setUploadFlow("results");
            setPanelTab("summary");
          });
        } else {
          finishToResults(() => {
            setAnalysisResult(null);
            setSelTodos([]);
            setAnalysisSource(null);
            setAnalysisError(response.errorMessage ?? "분석 중 오류가 발생했습니다. 다시 시도해주세요.");
            setUploadFlow("results");
          });
        }
      }).catch(() => {
        if (pollSessionRef.current !== pollSessionId) return;
        consecutiveNetworkFailures += 1;
        if (consecutiveNetworkFailures >= MEETING_STATUS_MAX_NETWORK_FAILURES) {
          stopPolling();
          setAnalysisResult(null);
          setSelTodos([]);
          setAnalysisSource(null);
          setAnalysisError("분석 상태 확인에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
          setUploadFlow("results");
        }
      });
    };

    void checkStatus();
    pollIntervalRef.current = setInterval(checkStatus, MEETING_STATUS_POLL_INTERVAL_MS);
  };

  useEffect(() => {
    if (searchParams.get("upload") === "1") {
      setUploadFlow("modal"); setModalStep(0); setUploadType(null);
      const next = new URLSearchParams(searchParams);
      next.delete("upload");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 서버에 저장된 회의록 목록을 가져와 로컬에 없는 항목만 보충한다.
  // 실패해도 화면은 로컬 저장 목록으로 그대로 동작한다.
  // 마운트 시의 초기 로드뿐 아니라, 회의록 수정(버전 생성) 후 목록을 다시 불러올 때도 재사용한다.
  const refreshMeetingsFromServer = () => {
    const cached = getStoredMeetings(projectId);
    return fetchMeetings(projectId)
      .then(list => {
        const deletedMeetingIds = getDeletedMeetingIds(projectId);
        const serverMeetings: Meeting[] = list.map(dto => {
          const status = dto.analysisStatus === "completed" ? "processed" : dto.analysisStatus === "failed" ? "failed" : dto.analysisStatus === "pending" ? "pending" : "processing";
          const base: Meeting = {
            id: dto.meetingId,
            title: dto.title,
            date: dto.meetingDate ?? "",
            duration: dto.analysisStatus === "completed" ? "분석 완료" : dto.analysisStatus,
            status,
            savedAt: dto.savedAt,
            originalMeetingId: dto.originalMeetingId,
            tasksRegistered: dto.tasksRegistered,
          };
          // 목록 API는 요약만 내려주므로, 이미 상세 분석 결과를 캐시해둔 회의록은 그 결과를 보존한다.
          // 그렇지 않으면 탭을 옮겼다가 돌아올 때마다 상세 조회를 다시 하게 되어 화면이 늦게 뜬다.
          const cachedMatch = cached.find(item => item.id === dto.meetingId);
          return cachedMatch?.summary && status === "processed" ? { ...cachedMatch, ...base } : base;
        });
        const serverIds = new Set(serverMeetings.map(meeting => meeting.id));
        const merged = [...serverMeetings, ...cached.filter(meeting => !serverIds.has(meeting.id) && !deletedMeetingIds.has(meeting.id))];
        setMeetings(merged);
        setSelected(current => (current && merged.some(meeting => meeting.id === current)) ? current : merged[0]?.id ?? null);
        saveStoredMeetings(merged, projectId);
      })
      .catch(() => {
        setMeetingListError("서버에서 회의록 목록을 불러오지 못했습니다. 로컬 저장 목록만 표시됩니다.");
        setTimeout(() => setMeetingListError(null), 4000);
      });
  };

  useEffect(() => {
    const cached = getStoredMeetings(projectId);
    setMeetings(cached);
    setSelected(cached[0]?.id ?? null);
    refreshMeetingsFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 알림의 "바로가기"를 통해 특정 회의록으로 딥링크된 경우, 저장 여부와 무관하게 항상
  // "분석/업로드" 탭에서 그 회의록의 분석 상세(요약/결정사항/To-Do)를 바로 보여준다.
  // "저장된 회의록" 탭은 목록만 보여주고 클릭해야 내용이 열리므로, 알림에서 바로 온
  // 사용자에게는 상세가 곧장 뜨는 이 탭이 맞다(역할분배 등 후속 작업이 To-Do 목록에서 이뤄짐).
  useEffect(() => {
    const targetMeetingId = searchParams.get("meetingId");
    if (!targetMeetingId || deepLinkHandledIdRef.current === targetMeetingId) return;
    setSelected(targetMeetingId);
    const target = meetings.find(item => item.id === targetMeetingId);
    if (!target) return;
    setHomeTab("analyze");
    deepLinkHandledIdRef.current = targetMeetingId;
  }, [searchParams, meetings]);

  // 참석자 체크 목록은 현재 프로젝트의 실제 멤버만 보여준다.
  useEffect(() => {
    if (currentProjectId == null) {
      setProjectMembers([]);
      return;
    }
    getProjectMembers(currentProjectId)
      .then(setProjectMembers)
      .catch(() => setProjectMembers([]));
  }, [currentProjectId]);

  // 목록 API는 요약만 내려주므로, 완료된 회의록을 클릭하면 상세 분석 결과를 별도로 불러와 화면에 채운다.
  useEffect(() => {
    const selectedMeeting = meetings.find(item => item.id === selected);
    if (!selectedMeeting || selectedMeeting.summary || !isServerMeetingId(selectedMeeting.id)) return;
    if (selectedMeeting.status === "pending" || selectedMeeting.status === "failed") return;

    let cancelled = false;
    fetchMeeting(projectId, selectedMeeting.id)
      .then(response => {
        if (cancelled) return;
        if (response.status === "COMPLETED" && response.analysis) {
          const detailedMeeting = buildMeetingFromAnalysisResponse(response, selectedMeeting);
          setMeetings(prev => {
            const next = prev.map(item => item.id === detailedMeeting.id ? detailedMeeting : item);
            saveStoredMeetings(next, projectId);
            return next;
          });
          return;
        }
        if (response.status === "FAILED") {
          setMeetings(prev => {
            const next = prev.map(item => item.id === selectedMeeting.id ? { ...item, duration: "분석 실패", status: "failed" as const } : item);
            saveStoredMeetings(next, projectId);
            return next;
          });
          setMeetingListError(response.errorMessage ?? "분석에 실패했습니다. 다시 분석을 시도해주세요.");
          setTimeout(() => setMeetingListError(null), 4000);
        }
      })
      .catch(error => {
        if (cancelled) return;
        const status = error instanceof ApiRequestError ? ` (${error.status})` : "";
        setMeetingListError(`분석 결과를 불러오지 못했습니다${status}. 잠시 후 다시 시도해주세요.`);
        setTimeout(() => setMeetingListError(null), 4000);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, meetings, projectId]);

  const meeting = meetings.find(m => m.id === selected);
  // meetingId가 있으면 우선 사용, 없으면(review 화면에서 아직 meetings에 반영 전 등) meetTitle로 대체.
  const meetingIdentifier = meeting?.id || meetTitle;
  const savedMeetingsList = meetings.filter(m => Boolean(m.savedAt));

  // ── Upload type metadata ─────────────────────────────────────────────────────
  const UPLOAD_TYPES = [
    { id:"document", label:"문서 업로드", desc:"PDF, Word, TXT, HWP 등 회의록 문서", icon:FileText, accept:".pdf,.doc,.docx,.txt,.hwp", color:"#3B5BDB", bg:"rgba(59,91,219,0.1)", note:"텍스트를 추출해 AI가 분석합니다." },
    { id:"audio",    label:"음성파일 업로드", desc:"mp3, wav, m4a 등 녹음파일", icon:Radio,    accept:".mp3,.wav,.m4a,.ogg", color:"#7048E8", bg:"rgba(112,72,232,0.1)", note:"음성을 텍스트로 변환한 뒤 분석합니다." },
  ] as const;

  const MEET_KINDS = ["정기회의","중간점검","발표준비","개발회의","기타"];

  const getAssignee = (todo: GenTodo): string => todoAssignees[todo.id] ?? todo.assignee;
  const getDueDate = (todo: GenTodo): string => todoDueDates[todo.id] ?? todo.dueDate;
  const toApiTodo = (todo: GenTodo) => {
    const assigneeId = getAssignee(todo);
    return {
      title: todo.title,
      description: todo.desc,
      assignee_candidate: "",
      assignee_id: assigneeId || null,
      due_date: getDueDate(todo) || null,
      priority: todo.priority.toUpperCase() as "HIGH" | "MEDIUM" | "LOW",
      category: todo.category,
      needs_leader_review: !assigneeId,
    };
  };

  const generatedTodos = analysisResult ? buildGeneratedTodos(analysisResult) : [];
  const riskCards = analysisResult ? buildRiskCards(analysisResult.risks) : [];
  const unassignedCount = generatedTodos.filter(t => !getAssignee(t)).length;
  const assignedCount = generatedTodos.filter(t => Boolean(getAssignee(t))).length;
  const nextActions = generatedTodos.slice(0, 3).map(t => t.title);
  const reviewTodos = [...generatedTodos, ...manualTodos];
  // 담당자 기준으로 묶어서 표시 (같은 담당자 업무가 연속 배치되도록) — 표시 순서만 바뀌고 원본 배열/등록 로직은 그대로 유지.
  const groupedGeneratedTodos = groupTodosByAssignee(generatedTodos, getAssignee);
  const isReviewBatchAlreadyRegistered = reviewTodos.length > 0 && reviewTodos.every(todo => {
    const key = buildTodoRegistrationKey(meetingIdentifier, todo.title, getAssignee(todo), getDueDate(todo));
    return getStoredTasks().some(task => buildTodoRegistrationKey(task.sourceMeetingTitle ?? "", task.title, task.assignee, task.dueDate) === key);
  });
  // 회의 상세 화면(meeting.todos, 문자열 배열)용 그룹 정렬 + 등록 여부 계산.
  const groupedMeetingTodos = meeting?.todos ? groupMeetingTodoLines(meeting.todos) : [];
  const isMeetingTodosRegistered = Boolean(meeting?.todos?.length) && meeting!.todos!.every(line => {
    const parsed = parseMeetingTodoLine(line);
    const matchedMember = projectMembers.find(m => m.name.trim() === parsed.assigneeName.trim());
    const assigneeId = matchedMember ? String(matchedMember.userId) : "";
    const key = buildTodoRegistrationKey(meetingIdentifier, parsed.title, assigneeId, parsed.dueDate);
    return getStoredTasks().some(task => buildTodoRegistrationKey(task.sourceMeetingTitle ?? "", task.title, task.assignee, task.dueDate) === key);
  });

  const handleAddManualTodo = () => {
    if (!newTodoTitle.trim() || !newTodoAssignee || !newTodoDueDate) {
      setNewTodoError("업무명, 담당자, 마감일은 필수입니다.");
      return;
    }
    const todo: GenTodo = {
      id: `MANUAL-${Date.now()}`,
      title: newTodoTitle.trim(),
      desc: newTodoDesc.trim(),
      category: newTodoCategory,
      assignee: newTodoAssignee,
      dueDate: formatAiDueDate(newTodoDueDate),
      priority: newTodoPriority,
      basis: "팀장이 직접 추가",
      assigned: true,
      source: canAddManualTodo ? "LEADER_MANUAL" : "MANUAL",
    };
    setManualTodos(prev => [...prev, todo]);
    setSelTodos(prev => [...prev, todo.id]);
    setShowAddTodo(false);
    setNewTodoTitle(""); setNewTodoDesc(""); setNewTodoCategory("other");
    setNewTodoAssignee(""); setNewTodoDueDate(""); setNewTodoPriority("medium");
    setNewTodoError(null);
  };

  const handleSaveMeeting = () => {
    if (!analysisResult) return;
    const meetingId = meeting?.id ?? selected ?? `local-${Date.now()}`;
    const record: SavedMeetingRecord = {
      meetingId,
      title: meetTitle,
      meetingDate: meetDate,
      meetingKind: meetKind,
      participants: partIds.map(id => projectMembers.find(member => String(member.userId) === id)?.name ?? id),
      originalFileName: selectedFile?.name ?? uploadFileName ?? "",
      fileType: uploadType,
      summary: analysisResult.summary,
      decisions: analysisResult.decisions,
      risks: analysisResult.risks,
      actionItems: reviewTodos,
      createdAt: new Date().toISOString(),
      source: "MEETING_AI",
    };
    const next = [record, ...getSavedMeetings(projectId).filter(item => item.meetingId !== meetingId)];
    saveSavedMeetings(next, projectId);
    setSaveMeetingMessage("회의록이 저장되었습니다.");
    setTimeout(() => setSaveMeetingMessage(null), 2500);
  };

  // 서버 저장확정(saved_at 확정 + MEETING_SAVED/_NOTIFY_LEADER 알림)을 먼저 시도하고,
  // 성공했을 때만 로컬 상태 반영(handleSaveMeeting)과 성공 메시지를 보여준다 — 순서를 바꾸면
  // 서버 저장이 실패해도 로컬은 이미 "저장됨"으로 보여 화면과 실제 상태가 어긋난다.
  const handleConfirmSave = async () => {
    if (!selected) return;
    setSaveMeetingError(null);
    try {
      await confirmMeetingSave(projectId, selected);
      handleSaveMeeting();
    } catch (error) {
      const status = error instanceof ApiRequestError ? ` (${error.status})` : "";
      setSaveMeetingError(`서버 저장에 실패했습니다${status}. 잠시 후 다시 시도해주세요.`);
      setTimeout(() => setSaveMeetingError(null), 6000);
    }
  };

  // 저장된 회의록 탭에서 "수정"/"AI 재분석하기"를 누르면 수정 화면(MeetingEditPanel)을 연다.
  // 상세 조회(fetchMeeting)로 실제 원문(transcript)을 가져온 뒤에 패널을 열어야
  // MeetingEditPanel의 초기 textarea 값이 빈 문자열로 뜨지 않는다.
  const handleOpenMeetingEdit = (meetingId: string) => {
    fetchMeeting(projectId, meetingId)
      .then(response => {
        setEditingTranscript(response.transcript ?? "");
        setEditingMeetingId(meetingId);
      })
      .catch(() => {
        setEditingTranscript("");
        setEditingMeetingId(meetingId);
      });
  };

  const closeMeetingEditAndRefresh = () => {
    setEditingMeetingId(null);
    setEditingTranscript("");
    void refreshMeetingsFromServer();
  };

  // 저장된 회의록 목록에서 항목을 클릭하면 분석결과가 아니라 원문(transcript)이 먼저 보여야 한다.
  // originalPreview는 renderResults()(업로드 직후 화면) 전용 모달이라 이 화면(메인 return)에서는
  // 렌더링되지 않으므로, 별도의 viewingOriginalMeeting 상태 + renderOriginalTextModal()을 쓴다.
  const handleViewSavedMeetingOriginal = (meeting: Meeting) => {
    setSelected(meeting.id);
    fetchMeeting(projectId, meeting.id)
      .then(response => {
        setViewingOriginalMeeting({ title: meeting.title, content: response.transcript ?? "" });
      })
      .catch(() => {
        setViewingOriginalMeeting({ title: meeting.title, content: "" });
      });
  };

  const handleViewOriginal = async () => {
    if (!selectedFile) {
      setOriginalViewMessage("원본 파일이 없습니다.");
      setTimeout(() => setOriginalViewMessage(null), 2500);
      return;
    }
    const ext = getFileExtension(selectedFile.name);
    if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
      const content = await decodeTextFile(selectedFile);
      setOriginalPreview({ kind: "text", content, fileName: selectedFile.name });
      return;
    }
    if (ext === "docx") {
      try {
        const content = await extractDocxText(selectedFile);
        setOriginalPreview({ kind: "text", content, fileName: selectedFile.name });
      } catch {
        setOriginalPreview({ kind: "unsupported", fileName: selectedFile.name });
      }
      return;
    }
    setOriginalPreview({ kind: "unsupported", fileName: selectedFile.name });
  };

  const handleExportPdf = async () => {
    if (!analysisResult) {
      setPdfExportMessage("분석 결과가 없어 PDF로 저장할 수 없습니다.");
      setTimeout(() => setPdfExportMessage(null), 2500);
      return;
    }
    const target = pdfCaptureRef.current;
    if (!target || isExportingPdf) return;

    setIsExportingPdf(true);
    try {
      const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const dateForFile = (meetDate || getTodayIsoDate()).replace(/-/g, "");
      const safeTitle = (meetTitle.trim() || "회의록").replace(/[\\/:*?"<>|]/g, "_");
      pdf.save(`회의록_${safeTitle}_${dateForFile}.pdf`);
    } catch {
      setPdfExportMessage("PDF 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
      setTimeout(() => setPdfExportMessage(null), 2500);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    const mb = file.size / (1024 * 1024);
    setSelectedFile(file);
    setUploadFileName(file.name);
    setUploadFileSize(mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`);
    setAnalysisError(null);
    if (!meetTitle.trim()) setMeetTitle(stripFileExtension(file.name));
  };

  const startAnalysis = () => {
    if (!selectedFile || !uploadType) {
      setAnalysisError("분석할 회의록 파일을 먼저 업로드해주세요.");
      return;
    }
    const fallbackCurrentUserId = user ? String(user.id) : null;
    const selectedAttendeeIds = partIds.length > 0
      ? partIds
      : fallbackCurrentUserId
        ? [fallbackCurrentUserId]
        : [];
    if (selectedAttendeeIds.length === 0) {
      setAnalysisError("프로젝트 멤버 정보를 불러온 뒤 참석자를 1명 이상 선택해주세요.");
      return;
    }
    if (partIds.length === 0) {
      setPartIds(selectedAttendeeIds);
    }
    const uploadedAt = new Date().toISOString();
    const title = meetTitle.trim() || stripFileExtension(selectedFile.name);
    setMeetTitle(title);
    setAnalysisResult(null);
    setSelTodos([]);
    setTodoAssignees({});
    setTodoDueDates({});
    setShowUnassigned(false);
    setAnalysisSource(null);
    setAnalysisError(null);
    setAnalyzeStage(0);
    setAnalyzeProgress(0);
    setAnalyzeProgressTarget(8);
    setAnalysisElapsedSeconds(0);
    setPollAttemptCount(0);
    setAnalysisPhase("uploading");
    setAnalysisRequestPending(true);
    setUploadFlow("analyzing");

    void analyzeMeeting({
      projectId,
      file: selectedFile,
      title,
      meetingDate: meetDate,
      meetingKind: meetKind,
      sourceType: uploadType,
      participants: selectedAttendeeIds.map(id => projectMembers.find(member => String(member.userId) === id)?.name ?? id),
      attendeeIds: selectedAttendeeIds.map(Number),
    }).then(response => {
      setAnalysisRequestPending(false);
      setActiveMeetingId(response.meetingId);
      setAnalysisPhase("queued");
      setAnalyzeProgressTarget(28);
      pollMeetingStatus(response.meetingId, title, uploadedAt);
    }).catch(() => {
      setAnalysisRequestPending(false);
      setAnalysisResult(null);
      setSelTodos([]);
      setAnalysisSource(null);
      setAnalysisError("분석 서버 연결에 실패했습니다. Spring Boot와 FastAPI 서버가 실행 중인지 확인한 뒤 다시 시도해주세요.");
      setUploadFlow("results");
    });
  };

  const handleRetryAnalysis = () => {
    if (!activeMeetingId) return;
    const uploadedAt = new Date().toISOString();
    setAnalysisResult(null);
    setSelTodos([]);
    setAnalysisSource(null);
    setAnalysisError(null);
    setAnalyzeStage(0);
    setAnalyzeProgress(0);
    setAnalyzeProgressTarget(8);
    setAnalysisElapsedSeconds(0);
    setPollAttemptCount(0);
    setAnalysisPhase("uploading");
    setAnalysisRequestPending(true);
    setUploadFlow("analyzing");

    void retryMeetingAnalysis(projectId, activeMeetingId).then(response => {
      setAnalysisRequestPending(false);
      setActiveMeetingId(response.meetingId);
      setAnalysisPhase("queued");
      setAnalyzeProgressTarget(28);
      pollMeetingStatus(response.meetingId, meetTitle, uploadedAt);
    }).catch(() => {
      setAnalysisRequestPending(false);
      setAnalysisError("재분석 요청에 실패했습니다. 다시 시도해주세요.");
      setUploadFlow("results");
    });
  };

  const removeMeetingFromLocalState = (meetingId: string) => {
    markDeletedMeeting(meetingId, projectId);
    setMeetings(prev => {
      const next = prev.filter(item => item.id !== meetingId);
      saveStoredMeetings(next, projectId);
      setSelected(current => current === meetingId ? next[0]?.id ?? null : current);
      return next;
    });
    saveSavedMeetings(
      getSavedMeetings(projectId).filter(item => item.meetingId !== meetingId),
      projectId
    );
    if (activeMeetingId === meetingId) {
      setActiveMeetingId(null);
      stopPolling();
    }
  };

  const removeLinkedLocalTasks = async (target: Meeting) => {
    const matchesMeeting = (task: Task) =>
      task.sourceMeetingTitle === target.id || task.sourceMeetingTitle === target.title;

    const localTasks = getStoredTasks();
    const linkedLocalTasks = localTasks.filter(matchesMeeting);
    if (linkedLocalTasks.length > 0) {
      saveStoredTasks(localTasks.filter(task => !matchesMeeting(task)));
    }

    for (const task of linkedLocalTasks) {
      if (/^\d+$/.test(task.id)) {
        try {
          await deleteTask(task.id, Number(projectId));
        } catch {
          // 로컬에는 이미 제거했으므로 서버 업무 삭제 실패는 회의록 삭제를 막지 않는다.
        }
      }
    }
  };

  const handleDeleteMeeting = async (target: Meeting, deleteLinkedTasks: boolean) => {
    if (deletingMeetingId) return;

    setDeleteTarget(null);
    setDeletingMeetingId(target.id);
    setMeetingListError(null);
    setDeleteMessage(null);
    try {
      if (isServerMeetingId(target.id)) {
        await deleteMeeting(projectId, target.id, deleteLinkedTasks);
      }
      if (deleteLinkedTasks) {
        await removeLinkedLocalTasks(target);
      }
      removeMeetingFromLocalState(target.id);
      setDeleteMessage(deleteLinkedTasks ? "회의록과 연동 업무가 삭제되었습니다." : "회의록이 삭제되었습니다.");
      setTimeout(() => setDeleteMessage(null), 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const isMissingMeeting =
        error instanceof ApiRequestError
          ? error.status === 404 || error.code === "MEETING_NOT_FOUND"
          : message.includes("회의록을 찾을 수 없습니다");
      if (isMissingMeeting) {
        if (deleteLinkedTasks) {
          await removeLinkedLocalTasks(target);
        }
        removeMeetingFromLocalState(target.id);
        setDeleteMessage("서버에 없는 회의록이라 목록에서 제거했습니다.");
        setTimeout(() => setDeleteMessage(null), 2500);
      } else {
        const statusCode = error instanceof ApiRequestError ? error.status : null;
        const isAuthError = statusCode === 401 || message.includes("인증이 만료") || message.includes("다시 로그인");
        const isPermissionError = statusCode === 403;
        const status = statusCode ? ` (${statusCode})` : "";
        const errorMessage = isAuthError
          ? "로그인이 만료되어 DB 삭제가 되지 않았습니다. 다시 로그인 후 삭제해주세요."
          : isPermissionError
            ? "본인이 업로드한 회의록만 삭제할 수 있습니다."
            : `서버 삭제에 실패했습니다${status}. DB에는 삭제되지 않았습니다. 잠시 후 다시 시도해주세요.`;
        setMeetingListError(errorMessage);
        setTimeout(() => setMeetingListError(null), 6000);
      }
    } finally {
      setDeletingMeetingId(null);
    }
  };

  // 이미 등록된 업무는 로컬 보드에 중복 카드를 만들지 않는다(서버도 동일 조건이면 재등록을 무시하므로 안전).
  const performRegisterSelectedTodos = async (todosToRegister: GenTodo[], existingKeys: Set<string>) => {
    const existingTasks = getStoredTasks();
    const now = Date.now();
    setIsRegisteringTasks(true);
    setRegisterMessage("업무보드에 등록 중입니다...");
    try {
      if (todosToRegister.length > 0) {
        await registerMeetingTasks(projectId, meetingIdentifier, todosToRegister.map(todo => toApiTodo(todo)));
      }

      const createdTasks: Task[] = todosToRegister
        .filter(todo => !existingKeys.has(buildTodoRegistrationKey(meetingIdentifier, todo.title, getAssignee(todo), getDueDate(todo))))
        .map((todo, index) => {
          const cat = getCat(todo.category);
          const sourceLabel = todo.source === "MEETING_AI" ? "회의록 AI" : "직접 추가";
          return {
            id: `AI-${now}-${String(index + 1).padStart(2, "0")}`,
            title: todo.title,
            status: "todo",
            priority: todo.priority,
            assignee: getAssignee(todo),
            dueDate: getDueDate(todo),
            category: todo.category,
            position: index,
            labels: [sourceLabel, cat.label],
            sourceMeetingTitle: meetingIdentifier,
          };
        });

      if (createdTasks.length > 0) {
        saveStoredTasks([...createdTasks, ...existingTasks]);
        addActivity(`회의록 AI로 '${meetingIdentifier}'의 업무 ${createdTasks.length}건을 업무보드에 등록했습니다.`, "김민준", "meeting-registered");
      }
      setUploadFlow("done");
    } catch {
      setRegisterMessage("서버에 업무 등록을 실패했습니다. 다시 시도해주세요.");
      setTimeout(() => setRegisterMessage(null), 2500);
    } finally {
      setIsRegisteringTasks(false);
    }
  };

  const registerSelectedTodos = async () => {
    if (isRegisteringTasks) return;
    const existingTasks = getStoredTasks();
    const existingKeys = new Set(
      existingTasks.map(task => buildTodoRegistrationKey(task.sourceMeetingTitle ?? "", task.title, task.assignee, task.dueDate))
    );

    const selectedGeneratedTodos = reviewTodos.filter(todo => selTodos.includes(todo.id));
    const newTodos = selectedGeneratedTodos.filter(todo => {
      const assignee = getAssignee(todo);
      const key = buildTodoRegistrationKey(meetingIdentifier, todo.title, assignee, getDueDate(todo));
      return !existingKeys.has(key);
    });

    if (selectedGeneratedTodos.length > 0 && newTodos.length === 0) {
      setConfirmReregister(() => () => {
        setConfirmReregister(null);
        void performRegisterSelectedTodos(selectedGeneratedTodos, existingKeys);
      });
      return;
    }

    await performRegisterSelectedTodos(newTodos, existingKeys);
  };

  type ParsedMeetingTodo = { assigneeName: string; title: string; dueDate: string; assigneeId: string };

  // 이미 등록된 업무는 로컬 보드에 중복 카드를 만들지 않는다(서버도 동일 조건이면 재등록을 무시하므로 안전).
  const performRegisterMeetingTodos = async (
    todosToRegister: ParsedMeetingTodo[],
    existingKeys: Set<string>,
    unassignedCount: number
  ) => {
    const existingTasks = getStoredTasks();
    setIsRegisteringTasks(true);
    setRegisterMessage("업무보드에 등록 중입니다...");
    try {
      if (todosToRegister.length > 0) {
        await registerMeetingTasks(projectId, meetingIdentifier, todosToRegister.map(todo => ({
          title: todo.title,
          description: "",
          assignee_candidate: todo.assigneeName,
          assignee_id: todo.assigneeId,
          due_date: todo.dueDate || null,
          priority: "MEDIUM",
          category: "ETC",
          needs_leader_review: false,
        })));
      }

      const now = Date.now();
      const createdTasks: Task[] = todosToRegister
        .filter(todo => !existingKeys.has(buildTodoRegistrationKey(meetingIdentifier, todo.title, todo.assigneeId, todo.dueDate)))
        .map((todo, index) => ({
          id: `AI-${now}-${String(index + 1).padStart(2, "0")}`,
          title: todo.title,
          status: "todo",
          priority: "medium",
          assignee: todo.assigneeId,
          dueDate: todo.dueDate,
          category: "other",
          position: index,
          labels: ["회의록 AI"],
          sourceMeetingTitle: meetingIdentifier,
        }));
      if (createdTasks.length > 0) {
        saveStoredTasks([...createdTasks, ...existingTasks]);
        addActivity(`회의록 AI로 '${meetingIdentifier}'의 업무 ${createdTasks.length}건을 업무보드에 등록했습니다.`, "김민준", "meeting-registered");
      }
      setRegisterMessage(
        unassignedCount > 0
          ? `업무 보드에 등록되었습니다. (미배정 업무 ${unassignedCount}건 포함, 업무보드에서 담당자를 지정해주세요)`
          : "업무 보드에 등록되었습니다."
      );
      setTimeout(() => setRegisterMessage(null), 2500);
    } catch {
      setRegisterMessage("서버에 업무 등록을 실패했습니다. 다시 시도해주세요.");
      setTimeout(() => setRegisterMessage(null), 2500);
    } finally {
      setIsRegisteringTasks(false);
    }
  };

  // 회의 상세 화면(meeting.todos, 문자열 배열)에서 "업무로 등록" 클릭 시 실행.
  const handleRegisterMeetingTodos = async () => {
    if (isRegisteringTasks) return;
    if (!meeting || !meeting.todos || meeting.todos.length === 0) return;
    const existingTasks = getStoredTasks();
    const existingKeys = new Set(
      existingTasks.map(task => buildTodoRegistrationKey(task.sourceMeetingTitle ?? "", task.title, task.assignee, task.dueDate))
    );

    const parsedTodos = meeting.todos.map(line => {
      const parsed = parseMeetingTodoLine(line);
      const matchedMember = projectMembers.find(m => m.name.trim() === parsed.assigneeName.trim());
      const assigneeId = matchedMember ? String(matchedMember.userId) : "";
      return { ...parsed, assigneeId };
    });

    const unassignedCount = parsedTodos.filter(todo => !todo.assigneeId).length;

    const newTodos = parsedTodos.filter(todo => {
      const key = buildTodoRegistrationKey(meetingIdentifier, todo.title, todo.assigneeId, todo.dueDate);
      return !existingKeys.has(key);
    });

    if (newTodos.length === 0) {
      if (parsedTodos.length > 0) {
        setConfirmReregister(() => () => {
          setConfirmReregister(null);
          void performRegisterMeetingTodos(parsedTodos, existingKeys, unassignedCount);
        });
        return;
      }
      return;
    }

    await performRegisterMeetingTodos(newTodos, existingKeys, unassignedCount);
  };

  const renderRegisteringOverlay = () => isRegisteringTasks ? (
    <div className="fixed inset-0 z-[70] bg-white/65 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-blue-100 bg-white shadow-2xl px-6 py-7 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
        </div>
        <div className="text-base font-bold text-foreground">업무보드에 등록 중입니다</div>
        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
          선택한 To-Do를 업무보드에 저장하고 담당자 정보를 반영하는 중입니다.
        </div>
      </div>
    </div>
  ) : null;

  const renderDeletingOverlay = () => deletingMeetingId ? (
    <div className="fixed inset-0 z-[70] bg-white/65 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-red-100 bg-white shadow-2xl px-6 py-7 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-7 h-7 text-red-600 animate-spin" />
        </div>
        <div className="text-base font-bold text-foreground">회의록을 삭제하는 중입니다</div>
        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
          회의록 데이터와 선택한 연동 정보를 정리하고 있습니다.
        </div>
      </div>
    </div>
  ) : null;

  const renderDeleteConfirmModal = () => deleteTarget ? (
    <div className="fixed inset-0 z-[65] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-border p-6">
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-4">
          <Trash2 className="w-6 h-6 text-red-600" />
        </div>
        <h2 className="text-lg font-bold text-foreground">회의록 삭제</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">
          '{deleteTarget.title}' 회의록을 삭제합니다. 업무보드에 등록된 To-Do는 선택에 따라 유지하거나 함께 삭제할 수 있습니다.
        </p>
        <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-900">회의록만 삭제</strong>를 선택하면 업무 목록은 그대로 남고, 원본 회의록 연결만 해제됩니다.
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-end">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteMeeting(deleteTarget, false)}
            className="px-4 py-2 text-sm font-semibold border border-blue-200 text-blue-700 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
          >
            회의록만 삭제
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteMeeting(deleteTarget, true)}
            className="px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg,#EF4444,#DC2626)" }}
          >
            회의록 + To-Do 삭제
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const renderOriginalTextModal = () => viewingOriginalMeeting ? (
    <div className="fixed inset-0 z-[65] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingOriginalMeeting(null)} />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="text-sm font-bold text-foreground truncate">{viewingOriginalMeeting.title}</div>
          <button onClick={() => setViewingOriginalMeeting(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors shrink-0">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {viewingOriginalMeeting.content ? (
            <pre className="text-xs text-foreground leading-relaxed" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'JetBrains Mono','Noto Sans KR',monospace" }}>
              {viewingOriginalMeeting.content}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-10 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 text-slate-300" />
              <div className="text-sm font-semibold text-foreground mb-1">원문을 불러오지 못했습니다.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const renderReregisterConfirmModal = () => confirmReregister ? (
    <div className="fixed inset-0 z-[65] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmReregister(null)} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-border p-6">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        </div>
        <h2 className="text-lg font-bold text-foreground">이미 등록된 업무입니다</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">
          선택한 업무가 이미 업무보드에 등록되어 있습니다. 한번 더 등록할까요?
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirmReregister(null)}
            className="px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirmReregister}
            className="px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
          >
            한번 더 등록
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Analyzing screen ────────────────────────────────────────────────────────
  const renderAnalyzing = () => {
    const phaseCopy = ANALYSIS_PHASE_COPY[analysisPhase];
    const waitHint = analysisPhase === "uploading"
      ? "파일 업로드와 분석 작업 생성이 끝나면 서버 상태 확인을 시작합니다"
      : `경과 ${formatElapsed(analysisElapsedSeconds)} · 상태 확인 ${pollAttemptCount}회`;
    const currentStageLabel = analyzeStages[analyzeStage] ?? "분석 준비";

    return (
    <div className="h-full flex items-center justify-center bg-background" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
      <div className="w-full max-w-lg px-6 text-center">
        {/* Spinner */}
        <div className="relative w-28 h-28 mx-auto mb-8">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
            <circle cx="56" cy="56" r="48" fill="none" stroke="#EEF1F8" strokeWidth="8" />
            <circle cx="56" cy="56" r="48" fill="none" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${(analyzeProgress / 100) * 301} 301`} stroke="url(#ag)" />
            <defs><linearGradient id="ag" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7048E8" /><stop offset="100%" stopColor="#4F6EF7" />
            </linearGradient></defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-foreground">{analyzeProgress}%</span>
            <span className="text-[10px] text-muted-foreground">분석 중</span>
          </div>
        </div>

        <div className="mb-2 text-xs font-mono text-muted-foreground">{uploadFileName || "업로드된 회의록"}</div>
        <h2 className="text-xl font-bold text-foreground mb-1">{phaseCopy.title}</h2>
        <p className="text-sm text-muted-foreground mb-5">{phaseCopy.message}</p>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {phaseCopy.badge}
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-left shadow-sm">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
            <span>현재 작업</span>
            <span>{waitHint}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">{currentStageLabel}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${analyzeProgress}%`, background: "linear-gradient(135deg,#3B5BDB,#7048E8)" }}
            />
          </div>
        </div>

        {/* Stage list */}
        <div className="space-y-2 text-left max-w-sm mx-auto">
          {analyzeStages.map((stage, i) => {
            const done = analyzeProgress >= 100 || i < analyzeStage; const active = analyzeProgress < 100 && i === analyzeStage;
            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${active ? "bg-blue-50 border border-blue-200" : done ? "opacity-60" : "opacity-30"}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-emerald-500" : active ? "border-2 border-blue-500" : "border-2 border-slate-300"}`}>
                  {done ? <Check className="w-3 h-3 text-white" /> : active ? <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /> : null}
                </div>
                <span className={`text-xs font-medium ${active ? "text-blue-700" : done ? "text-emerald-700" : "text-muted-foreground"}`}>{stage}</span>
                {active && <div className="ml-auto flex gap-0.5">{[0,1,2].map(j => <div key={j} className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay:`${j*0.15}s` }} />)}</div>}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-8">{waitHint}</p>
      </div>
    </div>
    );
  };

  // ── Results screen ───────────────────────────────────────────────────────────
  const renderResults = () => {
    if (!analysisResult) {
      return (
        <div className="h-full flex items-center justify-center bg-background" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
          <div className="w-full max-w-md px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-5">
              {analysisError ? <AlertTriangle className="w-8 h-8 text-amber-500" /> : <Sparkles className="w-8 h-8 text-blue-500 animate-pulse" />}
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">{analysisError ? "분석을 완료하지 못했습니다" : "분석 결과를 불러오는 중"}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              {analysisError ?? "업로드한 회의록의 요약, 결정사항, To-Do, 위험요소를 정리하고 있습니다."}
            </p>
            <div className="flex gap-3 justify-center">
              {analysisError && activeMeetingId && (
                <button onClick={handleRetryAnalysis} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity" style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                  다시 분석
                </button>
              )}
              <button onClick={() => setUploadFlow("modal")} className="px-5 py-2.5 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors">
                다시 업로드
              </button>
              <button onClick={() => setUploadFlow(null)} className="px-5 py-2.5 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors">
                회의록으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
    <div className="h-full flex overflow-hidden" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
      {/* Left: meeting list (mini) */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-600">AI 분석 완료</span>
          </div>
          <div className="text-sm font-bold text-foreground leading-snug">{meetTitle}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{meetDate} · {meetKind}</div>
          <div className="flex -space-x-1.5 mt-2">
            {partIds.map(id => {
              const m = projectMembers.find(pm => String(pm.userId) === id);
              if (!m) return null;
              const color = PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length];
              return (
                <div key={id} title={m.name} className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold" style={{ background:color }}>{m.name.slice(0,1)}</div>
              );
            })}
          </div>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(["summary","todos","risks"] as const).map(tab => {
            const l = { summary:"요약", todos:"To-Do", risks:"위험" };
            return <button key={tab} onClick={() => setPanelTab(tab)} className={`flex-1 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${panelTab===tab ? "border-blue-500 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l[tab]}</button>;
          })}
        </div>
        {/* Quick info */}
        <div className="p-4 space-y-2 text-xs text-muted-foreground border-b border-border">
          <div className="flex justify-between"><span>업로드 유형</span><span className="font-medium text-foreground">{UPLOAD_TYPES.find(u => u.id === uploadType)?.label ?? "문서 업로드"}</span></div>
          <div className="flex justify-between"><span>생성된 To-Do</span><span className="font-semibold text-blue-600">{generatedTodos.length}개</span></div>
          <div className="flex justify-between"><span>미배정 업무</span><span className="font-semibold text-amber-600">{unassignedCount}개</span></div>
          <div className="flex justify-between"><span>위험 요소</span><span className="font-semibold text-red-600">{riskCards.length}건</span></div>
        </div>
        {/* Actions */}
        <div className="p-4 space-y-2">
          {currentUserRole === "leader" && (
            <button onClick={() => setUploadFlow("review")}
              className="w-full py-2.5 text-sm font-semibold text-white rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
              <ListChecks className="w-4 h-4" />역할 분배 검토 →
            </button>
          )}
          {currentUserRole !== "reviewer" && (
            <button onClick={handleConfirmSave} className="w-full py-2 text-xs font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors flex items-center justify-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />{currentUserRole === "leader" ? "회의록 분석결과 저장" : "회의록 저장"}
            </button>
          )}
          {saveMeetingMessage && <div className="text-[10px] text-emerald-600 text-center">{saveMeetingMessage}</div>}
          {saveMeetingError && <div className="text-[10px] text-amber-600 text-center">{saveMeetingError}</div>}
          <button onClick={() => setUploadFlow(null)} className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            닫기
          </button>
        </div>
      </div>

      {/* Right: results */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ AI 분석 완료</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${analysisSource === "fastapi" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                {analysisSource === "fastapi" ? "Spring/FastAPI 응답" : "Spring 분석 응답"}
              </span>
              <span className="text-[10px] text-muted-foreground">{meetDate}</span>
            </div>
            <h1 className="text-lg font-bold text-foreground">{meetTitle}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{meetKind} · 참석자 {partIds.length}명</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button onClick={handleViewOriginal} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card rounded-lg hover:bg-muted transition-colors"><Eye className="w-3.5 h-3.5" />원본 보기</button>
              <button onClick={handleExportPdf} disabled={!analysisResult || isExportingPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card"><FileText className="w-3.5 h-3.5" />{isExportingPdf ? "PDF 생성 중..." : "PDF 저장"}</button>
            </div>
            {originalViewMessage && <div className="text-[10px] text-amber-600">{originalViewMessage}</div>}
            {pdfExportMessage && <div className="text-[10px] text-amber-600">{pdfExportMessage}</div>}
          </div>
        </div>

        {/* Summary tab */}
        {panelTab === "summary" && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4" style={{ color:"var(--accent)" }} />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI 회의 요약</span>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{analysisResult.summary}</p>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <CheckCheck className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">핵심 결정사항</span>
              </div>
              <ul className="space-y-2.5">
                {analysisResult.decisions.map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold text-emerald-600">{i + 1}</div>
                    <span className="text-sm text-foreground leading-relaxed">{d}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">다음 회의 전까지</div>
              <ul className="space-y-1.5">
                {(nextActions.length ? nextActions : ["담당자 검토 후 업무 보드에 등록"]).map((t, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                    <ArrowRight className="w-3.5 h-3.5 text-blue-500 shrink-0" />{t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Todos tab */}
        {panelTab === "todos" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">생성된 To-Do <span className="text-muted-foreground font-normal">({generatedTodos.length}개)</span></div>
              {currentUserRole === "leader" && (
                <button onClick={() => setUploadFlow("review")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90"
                  style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                  <ListChecks className="w-3.5 h-3.5" />역할 분배 검토
                </button>
              )}
            </div>
            {groupedGeneratedTodos.map(todo => {
              const assigneeId = getAssignee(todo);
              const m = projectMembers.find(me => String(me.userId) === assigneeId);
              const mColor = m ? PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length] : undefined;
              return (
                <div key={todo.id} className={`bg-card rounded-xl p-4 border shadow-sm ${!todo.assigned ? "border-amber-300" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CatTag catId={todo.category} />
                      {!todo.assigned && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">미배정</span>}
                    </div>
                    <PriorityBadge priority={todo.priority} />
                  </div>
                  <div className="text-sm font-semibold text-foreground mb-1">{todo.title}</div>
                  <div className="text-xs text-muted-foreground mb-2">{todo.desc}</div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {m ? (
                        <div className="flex items-center gap-1"><div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background:mColor }}>{m.name.slice(0,1)}</div><span className="text-muted-foreground">{m.name}</span></div>
                      ) : <span className="text-amber-600 font-medium">담당자 미배정</span>}
                    </div>
                    <span className="text-muted-foreground">마감 {todo.dueDate}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                    근거: <span className="text-foreground">{todo.basis}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Risks tab */}
        {panelTab === "risks" && (
          <div className="space-y-4">
            {riskCards.map((r, i) => (
              <div key={i} className={`rounded-xl p-5 border ${r.level==="high" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${r.level==="high" ? "text-red-500" : "text-amber-500"}`} />
                  <div>
                    <span className={`text-[10px] font-bold mr-2 ${r.level==="high" ? "text-red-700" : "text-amber-700"}`}>{r.level==="high"?"🔴 즉시 대응":"🟡 주의"}</span>
                    <span className={`text-sm font-semibold ${r.level==="high" ? "text-red-900" : "text-amber-900"}`}>{r.text}</span>
                  </div>
                </div>
                <div className={`flex items-start gap-1.5 text-xs mt-2 ${r.level==="high" ? "text-red-700" : "text-amber-700"}`}>
                  <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                  <span><strong>AI 추천 대응:</strong> {r.suggestion}</span>
                </div>
              </div>
            ))}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <div className="flex items-center gap-2 mb-1"><Sparkles className="w-3.5 h-3.5 text-blue-500" /><span className="text-xs font-semibold text-blue-700">AI 종합 제안</span></div>
              <p className="text-xs text-blue-800 leading-relaxed">핵심 키워드({analysisResult.keywords.slice(0, 4).join(", ")})를 기준으로 업무 우선순위를 정리하고, 미배정 업무는 팀장이 먼저 확정하는 것을 권장합니다.</p>
            </div>
          </div>
        )}
      </div>

      {/* PDF 캡처용 숨김 영역: 화면에는 보이지 않고 html2canvas가 이 DOM을 캡처해 PDF로 저장한다.
          Tailwind 클래스/CSS 변수(oklch 등) 대신 인라인 스타일만 사용 — html2canvas가 최신 CSS 색상 함수를 못 읽는 문제를 피하기 위함. */}
      <div style={{ position: "fixed", top: 0, left: "-10000px", width: "760px" }}>
        <div ref={pdfCaptureRef} style={{ background: "#ffffff", padding: "40px", width: "760px", fontFamily: "'Malgun Gothic','Apple SD Gothic Neo',sans-serif", color: "#1a1a1a" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 4px" }}>{meetTitle}</h1>
          <div style={{ fontSize: "12px", color: "#666666", marginBottom: "24px" }}>
            {meetDate} · {meetKind} · 참석자 {partIds.map(id => projectMembers.find(m => String(m.userId) === id)?.name ?? id).join(", ")}
          </div>

          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "20px 0 8px", borderBottom: "1px solid #dddddd", paddingBottom: "4px" }}>회의 요약</h2>
          <p style={{ fontSize: "13px", lineHeight: 1.7, margin: 0 }}>{analysisResult.summary}</p>

          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "20px 0 8px", borderBottom: "1px solid #dddddd", paddingBottom: "4px" }}>핵심 결정사항</h2>
          <ul style={{ fontSize: "13px", lineHeight: 1.7, margin: 0, paddingLeft: "20px" }}>
            {analysisResult.decisions.length
              ? analysisResult.decisions.map((d, i) => <li key={i}>{d}</li>)
              : <li>결정사항이 없습니다.</li>}
          </ul>

          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "20px 0 8px", borderBottom: "1px solid #dddddd", paddingBottom: "4px" }}>생성된 To-Do</h2>
          <ul style={{ fontSize: "13px", lineHeight: 1.7, margin: 0, paddingLeft: "20px" }}>
            {reviewTodos.length
              ? reviewTodos.map(t => {
                  const assigneeName = projectMembers.find(m => String(m.userId) === getAssignee(t))?.name ?? "미배정";
                  return <li key={t.id}>{t.title} - {assigneeName} ({getDueDate(t) || "마감일 미정"})</li>;
                })
              : <li>생성된 업무가 없습니다.</li>}
          </ul>

          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "20px 0 8px", borderBottom: "1px solid #dddddd", paddingBottom: "4px" }}>위험 요소</h2>
          <ul style={{ fontSize: "13px", lineHeight: 1.7, margin: 0, paddingLeft: "20px" }}>
            {analysisResult.risks.length
              ? analysisResult.risks.map((r, i) => <li key={i}>{r}</li>)
              : <li>감지된 위험 요소가 없습니다.</li>}
          </ul>
        </div>
      </div>

      {/* 원본 보기 모달 */}
      {originalPreview && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setOriginalPreview(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                <div className="text-sm font-bold text-foreground truncate">{originalPreview.fileName}</div>
                <button onClick={() => setOriginalPreview(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors shrink-0"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {originalPreview.kind === "text" ? (
                  <pre className="text-xs text-foreground leading-relaxed" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'JetBrains Mono','Noto Sans KR',monospace" }}>
                    {originalPreview.content}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-10 text-muted-foreground">
                    <FileText className="w-10 h-10 mb-3 text-slate-300" />
                    <div className="text-sm font-semibold text-foreground mb-1">이 파일 형식은 원본 미리보기를 지원하지 않습니다.</div>
                    <div className="text-xs">저장된 파일명: {originalPreview.fileName}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
    );
  };

  // ── Review screen ────────────────────────────────────────────────────────────
  const renderReview = () => {
    const todos = showUnassigned ? reviewTodos.filter(t => !getAssignee(t)) : reviewTodos;
    const approvedCount = selTodos.length;
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
        {renderRegisteringOverlay()}
        {/* Header */}
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between mb-3">
            <div>
              <button onClick={() => setUploadFlow("results")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors group">
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />분석 결과로 돌아가기
              </button>
              <h1 className="text-xl font-bold text-foreground">역할 분배 검토</h1>
              <p className="text-sm text-muted-foreground mt-0.5">팀장이 확인하고 승인한 업무만 업무 보드에 등록됩니다.</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowUnassigned(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${showUnassigned ? "border-amber-400 bg-amber-50 text-amber-700" : "border-border bg-card text-muted-foreground hover:border-slate-300"}`}>
                  <AlertTriangle className="w-3.5 h-3.5" />미배정만 보기 {showUnassigned && <span className="bg-amber-200 text-amber-800 px-1 rounded text-[10px]">{unassignedCount}</span>}
                </button>
                {currentUserRole === "leader" && (isReviewBatchAlreadyRegistered ? (
                  <button onClick={() => { setUploadFlow(null); navigate("/board"); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
                    style={{ background:"linear-gradient(135deg,#10B981,#059669)" }}>
                    <CheckCircle2 className="w-4 h-4" />등록 완료 · 업무보드 확인
                  </button>
                ) : (
                  <button onClick={registerSelectedTodos}
                    disabled={approvedCount === 0 || isRegisteringTasks}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                    {isRegisteringTasks ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {isRegisteringTasks ? "업무보드 등록 중" : `${approvedCount}개 업무 보드에 등록`}
                  </button>
                ))}
              </div>
              {registerMessage && <div className="text-[11px] text-amber-600">{registerMessage}</div>}
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">{generatedTodos.length}개 AI 생성</span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">{assignedCount}개 배정 완료</span>
            <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">{unassignedCount}개 미배정</span>
            {manualTodos.length > 0 && <span className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 font-medium">{manualTodos.length}개 직접 추가</span>}
            <button onClick={() => setSelTodos(reviewTodos.map(t=>t.id))} className="ml-auto text-xs text-blue-600 hover:text-blue-700 underline underline-offset-2">전체 선택</button>
            <button onClick={() => setSelTodos([])} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">전체 해제</button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 pb-24">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="pl-4 pr-2 py-3 w-8" />
                  {["ID","업무명","카테고리","담당자","마감일","우선순위","근거"].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {todos.map(todo => {
                  const checked = selTodos.includes(todo.id);
                  const assigneeId = getAssignee(todo);
                  const isUnassigned = !assigneeId;
                  return (
                    <tr key={todo.id} className={`hover:bg-muted/30 transition-colors ${isUnassigned ? "bg-amber-50/30" : ""}`}>
                      <td className="pl-4 pr-2 py-3">
                        <div onClick={() => setSelTodos(p => checked ? p.filter(x=>x!==todo.id) : [...p,todo.id])}
                          className={`w-4 h-4 rounded border cursor-pointer flex items-center justify-center transition-all ${checked ? "border-blue-500 bg-blue-500" : "border-border hover:border-blue-400"}`}>
                          {checked && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{todo.id}</td>
                      <td className="px-3 py-3 max-w-[180px]">
                        <div className="text-xs font-semibold text-foreground">{todo.title}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{todo.desc}</div>
                      </td>
                      <td className="px-3 py-3"><CatTag catId={todo.category} /></td>
                      <td className="px-3 py-3">
                        <select value={assigneeId} onChange={e => setTodoAssignees(p => ({ ...p, [todo.id]: e.target.value }))}
                          className={`text-xs rounded-lg border px-2 py-1.5 outline-none focus:border-blue-400 cursor-pointer ${isUnassigned ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border bg-card text-foreground"}`}>
                          <option value="">⚠ 미배정</option>
                          {projectMembers.length === 0 && <option value="" disabled>프로젝트 멤버 불러오는 중...</option>}
                          {projectMembers.map(m => <option key={m.userId} value={String(m.userId)}>{m.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="MM.DD"
                          value={getDueDate(todo)}
                          onChange={e => setTodoDueDates(p => ({ ...p, [todo.id]: formatMMDDInput(e.target.value) }))}
                          className="text-xs rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-blue-400 w-16 text-center"
                        />
                      </td>
                      <td className="px-3 py-3"><PriorityBadge priority={todo.priority} /></td>
                      <td className="px-3 py-3 text-[10px] text-muted-foreground max-w-[120px] truncate" title={todo.basis}>{todo.basis}</td>
                      <td className="px-3 py-3">
                        <button className="p-1 hover:bg-muted rounded transition-colors"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add task */}
          {canAddManualTodo && (
            <div className="mt-3">
              {!showAddTodo && (
                <button onClick={() => setShowAddTodo(true)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-blue-600 border border-dashed border-blue-300 rounded-xl hover:bg-blue-50 transition-colors">
                  <Plus className="w-3.5 h-3.5" />새 업무 직접 추가
                </button>
              )}
              {showAddTodo && (
                <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs font-semibold text-foreground block mb-1.5">업무명 <span className="text-red-500">*</span></label>
                      <input value={newTodoTitle} onChange={e => setNewTodoTitle(e.target.value)} placeholder="업무명을 입력하세요"
                        className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-semibold text-foreground block mb-1.5">설명</label>
                      <input value={newTodoDesc} onChange={e => setNewTodoDesc(e.target.value)} placeholder="업무 설명 (선택)"
                        className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">카테고리</label>
                      <select value={newTodoCategory} onChange={e => setNewTodoCategory(e.target.value as CatId)}
                        className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400">
                        {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">담당자 <span className="text-red-500">*</span></label>
                      <select value={newTodoAssignee} onChange={e => setNewTodoAssignee(e.target.value)}
                        className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400">
                        <option value="">담당자 선택</option>
                        {projectMembers.length === 0 && <option value="" disabled>프로젝트 멤버 불러오는 중...</option>}
                        {projectMembers.map(m => <option key={m.userId} value={String(m.userId)}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">마감일 <span className="text-red-500">*</span></label>
                      <input type="date" value={newTodoDueDate} onChange={e => setNewTodoDueDate(e.target.value)}
                        className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">우선순위</label>
                      <div className="flex gap-1.5">
                        {(["low","medium","high"] as Priority[]).map(p => (
                          <button key={p} type="button" onClick={() => setNewTodoPriority(p)}
                            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg border transition-all ${newTodoPriority===p ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-card text-muted-foreground"}`}>
                            {p==="low"?"낮음":p==="medium"?"중간":"높음"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {newTodoError && <div className="text-[11px] text-red-600">{newTodoError}</div>}
                  <div className="flex items-center gap-2 justify-end pt-1">
                    <button onClick={() => { setShowAddTodo(false); setNewTodoError(null); }} className="px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">취소</button>
                    <button onClick={handleAddManualTodo} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90 transition-opacity" style={{ background:"var(--primary)" }}>추가</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Done screen ──────────────────────────────────────────────────────────────
  const renderDone = () => (
    <div className="h-full flex items-center justify-center bg-background" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
      <div className="text-center max-w-md px-6">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6" style={{ background:"linear-gradient(135deg,#10B981,#059669)" }}>
          <CheckCircle2 className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">업무 등록 완료!</h1>
        <p className="text-sm text-muted-foreground mb-2">{selTodos.length}개 업무가 업무 보드에 등록되었습니다.</p>
        <p className="text-xs text-muted-foreground mb-8">담당자별 할 일, 마일스톤 진행률, 대시보드가 자동으로 업데이트됩니다.</p>

        {/* Where registered */}
        <div className="grid grid-cols-2 gap-3 text-left mb-8">
          {[
            { icon:Columns3, label:"업무 보드", desc:"'할 일' 컬럼에 추가됨", color:"#3B5BDB" },
            { icon:Users, label:"담당자 할 일", desc:"개인 업무 목록에 반영", color:"#7048E8" },
            { icon:LayoutDashboard, label:"대시보드", desc:"전체 업무 수 업데이트", color:"#10B981" },
            { icon:Calendar, label:"캘린더", desc:"마감일 기반 일정 등록", color:"#F59E0B" },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border shadow-sm">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background:`${item.color}15` }}>
                  <Icon className="w-4 h-4" style={{ color:item.color }} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 justify-center">
          <button onClick={() => setUploadFlow(null)} className="px-5 py-2.5 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors">
            회의록으로 돌아가기
          </button>
          <button onClick={() => { setUploadFlow(null); navigate("/board"); }} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity" style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
            업무 보드 확인하기
          </button>
        </div>
      </div>
    </div>
  );

  // ── Early returns for full-screen states ─────────────────────────────────────
  if (uploadFlow === "analyzing") return renderAnalyzing();
  if (uploadFlow === "results")   return renderResults();
  if (uploadFlow === "review")    return renderReview();
  if (uploadFlow === "done")      return renderDone();

  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
      {renderRegisteringOverlay()}
      {renderDeletingOverlay()}
      {renderDeleteConfirmModal()}
      {renderReregisterConfirmModal()}
      {renderOriginalTextModal()}

      <div className="flex gap-2 border-b border-border px-4 shrink-0">
        <button
          onClick={() => setHomeTab("analyze")}
          className={`px-4 py-2 text-sm font-semibold ${homeTab === "analyze" ? "border-b-2 border-blue-600 text-blue-600" : "text-muted-foreground"}`}
        >
          분석/업로드
        </button>
        <button
          onClick={() => setHomeTab("saved")}
          className={`px-4 py-2 text-sm font-semibold ${homeTab === "saved" ? "border-b-2 border-blue-600 text-blue-600" : "text-muted-foreground"}`}
        >
          저장된 회의록
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {homeTab === "analyze" && (
      <>
      {/* ── Upload modal ── */}
      {uploadFlow === "modal" && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setUploadFlow(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <div className="text-lg font-bold text-foreground">회의록 업로드</div>
                  <div className="text-xs text-muted-foreground mt-0.5">회의 파일을 업로드하면 AI가 자동으로 분석하고 업무를 생성합니다.</div>
                </div>
                <button onClick={() => setUploadFlow(null)} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-5 h-5 text-muted-foreground" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Step 0: type selection */}
                {modalStep === 0 && (
                  <div>
                    <div className="text-sm font-semibold text-foreground mb-3">업로드 유형 선택</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {UPLOAD_TYPES.map(t => {
                        const Icon = t.icon; const sel = uploadType === t.id;
                        return (
                          <button key={t.id} onClick={() => {
                            const nextType = t.id as UploadType;
                            setUploadType(nextType);
                            setSelectedFile(null);
                            setUploadFileName("");
                            setUploadFileSize("");
                            setAnalysisError(null);
                          }}
                            className={`min-h-[180px] flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 transition-all hover:shadow-sm ${sel ? "shadow-sm" : "border-border hover:border-slate-300"}`}
                            style={sel ? { borderColor:t.color, background:t.bg } : {}}>
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:sel ? t.bg : "#F4F6FA" }}>
                              <Icon className="w-6 h-6" style={{ color:t.color }} />
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-bold text-foreground">{t.label}</div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                            </div>
                            {sel && <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background:t.color }}><Check className="w-3 h-3 text-white" /></div>}
                          </button>
                        );
                      })}
                    </div>
                    {uploadType && (
                      <div className="mt-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        {UPLOAD_TYPES.find(t => t.id === uploadType)?.note}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1: form + file upload */}
                {modalStep === 1 && uploadType && (() => {
                  const utype = UPLOAD_TYPES.find(t => t.id === uploadType)!;
                  const Icon = utype.icon;
                  return (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:utype.bg }}><Icon className="w-4 h-4" style={{ color:utype.color }} /></div>
                        <span className="text-sm font-bold text-foreground">{utype.label}</span>
                      </div>

                      {/* File drop zone */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={utype.accept}
                        className="hidden"
                        onChange={e => handleFileSelect(e.target.files?.[0])}
                      />
                      <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer"
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                        onDragEnter={e => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleFileSelect(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => fileInputRef.current?.click()}>
                        {uploadFileName ? (
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background:utype.bg }}><Icon className="w-6 h-6" style={{ color:utype.color }} /></div>
                            <div className="text-sm font-semibold text-foreground">{uploadFileName}</div>
                            <div className="text-[10px] text-muted-foreground">{uploadFileSize || "파일 선택됨"}</div>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">업로드 완료</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="w-8 h-8 text-muted-foreground" />
                            <div className="text-sm font-medium text-foreground">파일을 드래그하거나 클릭하여 업로드</div>
                            <div className="text-xs text-muted-foreground">{utype.accept.toUpperCase().replace(/\./g,'').replace(/,/g,', ')} 지원</div>
                          </div>
                        )}
                      </div>

                      {/* Metadata form */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-foreground block mb-1.5">회의 제목 <span className="text-red-500">*</span></label>
                          <input value={meetTitle} onChange={e => setMeetTitle(e.target.value)} placeholder="예: 7차 정기 회의 — 결제 연동 점검"
                            className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground block mb-1.5">회의 날짜</label>
                          <input type="date" value={meetDate} onChange={e => setMeetDate(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground block mb-1.5">회의 유형</label>
                          <select value={meetKind} onChange={e => setMeetKind(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400">
                            {MEET_KINDS.map(k => <option key={k}>{k}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Participants */}
                      <div>
                        <label className="text-xs font-semibold text-foreground block mb-2">참석자</label>
                        {projectMembers.length === 0 ? (
                          <p className="text-xs text-muted-foreground">프로젝트 멤버 정보를 불러오는 중입니다.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {projectMembers.map(m => {
                              const id = String(m.userId);
                              const sel = partIds.includes(id);
                              const color = PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length];
                              return (
                                <button key={id} onClick={() => setPartIds(p => sel ? p.filter(x=>x!==id) : [...p,id])}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${sel ? "border-blue-400 bg-blue-50 text-blue-700" : "border-border bg-card text-muted-foreground hover:border-slate-300"}`}>
                                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold" style={{ background:color }}>{m.name.slice(0,1)}</div>
                                  {m.name}
                                  {sel && <Check className="w-3 h-3" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {analysisError && (
                          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <span>{analysisError}</span>
                          </div>
                        )}
                      </div>

                      {/* Auto analyze toggle */}
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/50 border border-border">
                        <div>
                          <div className="text-xs font-semibold text-foreground">자동 분석 시작</div>
                          <div className="text-[10px] text-muted-foreground">업로드 후 즉시 AI 분석을 시작합니다.</div>
                        </div>
                        <div className="w-10 h-6 rounded-full flex items-center px-0.5 cursor-pointer" style={{ background:"var(--primary)" }}>
                          <div className="w-5 h-5 rounded-full bg-white shadow-sm ml-auto" />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                <button onClick={() => modalStep===0 ? setUploadFlow(null) : setModalStep(0)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors">
                  <ArrowLeft className="w-4 h-4" />{modalStep===0?"취소":"이전"}
                </button>
                {modalStep === 0 ? (
                  <button onClick={() => setModalStep(1)} disabled={!uploadType}
                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                    style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                    다음<ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={startAnalysis}
                    disabled={!selectedFile}
                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                    style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
                    <Sparkles className="w-4 h-4" />AI 분석 시작
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Meeting list ── */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <button onClick={() => { setUploadFlow("modal"); setModalStep(0); setUploadType(null); setUploadFileName(""); setUploadFileSize(""); setSelectedFile(null); setAnalysisSource(null); setAnalysisError(null); }}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background:"linear-gradient(135deg,#7048E8 0%,#4F6EF7 100%)" }}>
            <Upload className="w-4 h-4" />회의록 업로드
          </button>
          <button className="p-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors">
            <Mic className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {meetingListError && <div className="text-[11px] text-amber-600 px-1">{meetingListError}</div>}
          {deleteMessage && <div className="text-[11px] text-emerald-600 px-1">{deleteMessage}</div>}
          {meetings.length === 0 ? (
            <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center px-4 text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <FileAudio className="w-7 h-7 text-slate-400" />
              </div>
              <div className="text-sm font-semibold text-foreground mb-1">아직 업로드한 회의록이 없습니다</div>
              <div className="text-xs leading-relaxed mb-4">문서 또는 음성 파일을 업로드하면 AI 분석 결과가 이곳에 자동으로 쌓입니다.</div>
              <button onClick={() => { setUploadFlow("modal"); setModalStep(0); setUploadType(null); setUploadFileName(""); setUploadFileSize(""); setSelectedFile(null); setAnalysisError(null); }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
                회의록 업로드
              </button>
            </div>
          ) : meetings.map(m => (
            <div key={m.id} onClick={() => setSelected(m.id)}
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(m.id);
                }
              }}
              className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${selected === m.id ? "border-blue-300 bg-blue-50" : "border-border bg-card hover:bg-muted"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-muted-foreground">{m.date}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${m.status === "processed" ? "bg-emerald-100 text-emerald-600" : m.status === "processing" ? "bg-blue-100 text-blue-600" : m.status === "failed" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                    {m.status === "processed" ? "AI 분석 완료" : m.status === "processing" ? "분석 중" : m.status === "failed" ? "분석 실패" : "예정"}
                  </span>
                  {currentUserRole === "leader" && (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        setDeleteTarget(m);
                      }}
                      disabled={Boolean(deletingMeetingId)}
                      className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="회의록 삭제"
                      aria-label={`${m.title} 회의록 삭제`}
                    >
                      {deletingMeetingId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm font-medium text-foreground leading-snug">{m.title}</div>
              {m.duration !== "—" && <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{m.duration}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {meeting && meeting.summary ? (
          <div className="max-w-2xl space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>AI 회의록 분석</span>
              </div>
              <h2 className="text-lg font-bold text-foreground">{meeting.title}</h2>
              <div className="text-xs text-muted-foreground mt-0.5">{meeting.date} · {meeting.duration}</div>
              {(meeting.uploadedAt || meeting.analyzedAt) && (
                <div className="text-[10px] text-muted-foreground mt-1 space-x-3">
                  {meeting.uploadedAt && <span>업로드 {formatDateTime(meeting.uploadedAt)}</span>}
                  {meeting.analyzedAt && <span>분석 완료 {formatDateTime(meeting.analyzedAt)}</span>}
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">회의 요약</div>
              <p className="text-sm text-foreground leading-relaxed">{meeting.summary}</p>
            </div>

            {meeting.decisions && (
              <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCheck className="w-4 h-4 text-emerald-500" />
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">핵심 결정사항</div>
                </div>
                <ul className="space-y-2">
                  {meeting.decisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {meeting.todos && (
              <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4" style={{ color: "var(--primary)" }} />
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">생성된 To-Do</div>
                  </div>
                  {currentUserRole === "leader" && (isMeetingTodosRegistered ? (
                    <button onClick={() => { navigate("/board"); }}
                      className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
                      등록 완료 · 업무보드 확인
                    </button>
                  ) : (
                    <button
                      onClick={handleRegisterMeetingTodos}
                      disabled={meeting.todos.length === 0 || isRegisteringTasks}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed">
                      {isRegisteringTasks && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {isRegisteringTasks ? "등록 중" : "업무로 등록"}
                    </button>
                  ))}
                </div>
                {registerMessage && <div className="text-[11px] text-amber-600 mb-2">{registerMessage}</div>}
                <ul className="space-y-2">
                  {groupedMeetingTodos.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {meeting.risks && (
              <div className="rounded-xl p-5 border border-amber-200 bg-amber-50">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider">위험 요소</div>
                </div>
                <ul className="space-y-2">
                  {meeting.risks.map((r, i) => (
                    <li key={i} className="text-sm text-amber-800">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : meeting ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <Clock className="w-12 h-12 text-muted" />
            <div className="text-sm font-medium">
              {meeting.status === "pending" ? "예정된 회의입니다" : meeting.status === "processing" ? "AI 분석 중입니다. 잠시 후 다시 확인해주세요" : meeting.status === "failed" ? "AI 분석에 실패했습니다. 다시 업로드하거나 재분석을 시도해주세요" : "AI 분석 결과를 불러오는 중입니다"}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <FileAudio className="w-8 h-8 text-slate-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground mb-1">
                {meetings.length === 0 ? "분석할 회의록을 업로드해주세요" : "회의록을 선택하세요"}
              </div>
              <div className="text-xs leading-relaxed max-w-sm">
                {meetings.length === 0
                  ? "업로드 후 분석이 완료되면 회의 요약, 핵심 결정사항, 생성된 To-Do, 위험 요소가 이 화면에 표시됩니다."
                  : "왼쪽 목록에서 분석된 회의록을 선택하면 상세 결과를 확인할 수 있습니다."}
              </div>
            </div>
            {meetings.length === 0 && (
              <button onClick={() => { setUploadFlow("modal"); setModalStep(0); setUploadType(null); setUploadFileName(""); setUploadFileSize(""); setSelectedFile(null); setAnalysisError(null); }}
                className="mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
                회의록 업로드
              </button>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {homeTab === "saved" && (
        <div className="flex-1 overflow-y-auto p-6">
          {editingMeetingId ? (
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-foreground">회의록 수정</div>
                <button type="button" onClick={() => setEditingMeetingId(null)}
                  className="text-xs text-muted-foreground hover:underline">
                  취소
                </button>
              </div>
              <MeetingEditPanel
                projectId={projectId}
                meetingId={editingMeetingId}
                initialTranscript={editingTranscript}
                onSaved={closeMeetingEditAndRefresh}
                onAnalyzed={closeMeetingEditAndRefresh}
              />
            </div>
          ) : savedMeetingsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <FileAudio className="w-8 h-8 text-slate-400" />
              </div>
              <div className="text-sm font-semibold text-foreground mb-1">저장된 회의록이 없습니다</div>
              <div className="text-xs leading-relaxed max-w-sm">회의록 분석 후 '회의록 분석결과 저장'을 눌러 저장하면 이곳에 표시됩니다.</div>
            </div>
          ) : (
            <div className="space-y-2 max-w-2xl">
              {savedMeetingsList.map(m => {
                const isPendingVersion = Boolean(m.originalMeetingId) && m.status === "pending";
                return (
                <div key={m.id} onClick={() => handleViewSavedMeetingOriginal(m)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleViewSavedMeetingOriginal(m);
                    }
                  }}
                  className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${selected === m.id ? "border-blue-300 bg-blue-50" : "border-border bg-card hover:bg-muted"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">{m.date}</span>
                    <div className="flex items-center gap-1.5">
                      {m.tasksRegistered && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">등록완료</span>
                      )}
                      {m.originalMeetingId && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">수정됨</span>
                      )}
                      {currentUserRole !== "reviewer" && (
                        <button
                          type="button"
                          onClick={event => { event.stopPropagation(); handleOpenMeetingEdit(m.id); }}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-border text-foreground hover:bg-muted"
                        >
                          {isPendingVersion ? "AI 재분석하기" : "수정"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-medium text-foreground leading-snug">{m.title}</div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
