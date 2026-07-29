import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildGeneratedTodos, deriveCurrentUserRole, MeetingsView } from "./MeetingsView";
import type { MeetingAiResult } from "../libs/types/meetingAiTypes";
import { ApiRequestError } from "../../global/api/apiClient";
import { toast } from "sonner";

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

const asLeader = () => ({
  user: { id: 1, email: "leader@test.com", name: "김민준" },
  projectRoles: [{ projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" }],
  currentProjectId: 1,
  currentProject: { projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" },
  logout: vi.fn(),
});

const asReviewer = () => ({
  user: { id: 2, email: "reviewer@test.com", name: "박심사" },
  projectRoles: [{ projectId: 1, projectTitle: "테스트 프로젝트", role: "심사자" }],
  currentProjectId: 1,
  currentProject: { projectId: 1, projectTitle: "테스트 프로젝트", role: "심사자" },
  logout: vi.fn(),
});

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn().mockResolvedValue([
    { userId: 1, name: "김민준", email: "leader@test.com", role: "팀장" },
  ]),
}));

const fetchMeetings = vi.fn();
const fetchMeeting = vi.fn();
const deleteMeeting = vi.fn();
const deleteMeetingAnalysis = vi.fn();
const retryMeetingAnalysis = vi.fn();
const registerMeetingTasks = vi.fn();
const analyzeMeeting = vi.fn();

vi.mock("../libs/utils/meetingAiApi", () => ({
  analyzeMeeting: (...args: unknown[]) => analyzeMeeting(...args),
  confirmMeetingSave: vi.fn(),
  fetchMeeting: (...args: unknown[]) => fetchMeeting(...args),
  fetchMeetings: (...args: unknown[]) => fetchMeetings(...args),
  deleteMeeting: (...args: unknown[]) => deleteMeeting(...args),
  deleteMeetingAnalysis: (...args: unknown[]) => deleteMeetingAnalysis(...args),
  retryMeetingAnalysis: (...args: unknown[]) => retryMeetingAnalysis(...args),
  registerMeetingTasks: (...args: unknown[]) => registerMeetingTasks(...args),
}));

const mockStartRecording = vi.fn();
let mockRecordingStatus: "idle" | "requesting-permission" | "recording" | "stopped" | "error" = "idle";

vi.mock("../libs/hooks/RecordingSessionProvider", () => ({
  useRecordingSession: () => ({
    status: mockRecordingStatus,
    error: null,
    startRecording: mockStartRecording,
    requestStop: vi.fn(),
    pendingBlob: null,
    clearPendingBlob: vi.fn(),
  }),
}));

const mockPdfSave = vi.fn();
vi.mock("html2canvas", () => ({
  default: vi.fn().mockResolvedValue({
    width: 100,
    height: 100,
    toDataURL: () => "data:image/png;base64,",
  }),
}));
vi.mock("jspdf", () => ({
  default: vi.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: mockPdfSave,
  })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseResult = (assignee_id: string | null): MeetingAiResult => ({
  summary: "요약",
  decisions: [],
  risks: [],
  keywords: [],
  meeting_meta: { title: "정기회의", meeting_date: "2026-07-09", participants: ["김민준", "이서연", "박지수", "최동혁"] },
  todos: [
    {
      title: "인증과 권한 구조",
      description: "인증과 권한 구조는 제가 먼저 잡겠습니다.",
      assignee_candidate: "곽진아",
      assignee_id,
      due_date: "2026-07-12",
      priority: "HIGH",
      category: "BACKEND",
      needs_leader_review: assignee_id === null,
    },
  ],
});

describe("buildGeneratedTodos", () => {
  it("leaves the todo unassigned when the server returns a null assignee_id, without defaulting to any member", () => {
    const todos = buildGeneratedTodos(baseResult(null));

    expect(todos[0].assignee).toBe("");
    expect(todos[0].assigned).toBe(false);
  });

  it("trusts the server-provided assignee_id when present, without re-deriving it from assignee_candidate", () => {
    const todos = buildGeneratedTodos(baseResult("3"));

    expect(todos[0].assignee).toBe("3");
    expect(todos[0].assigned).toBe(true);
  });

  it("uses the server-provided evidence_text as the basis when present", () => {
    const result = baseResult(null);
    result.todos[0].evidence_text = "곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다.";

    const todos = buildGeneratedTodos(result);

    expect(todos[0].basis).toBe("곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다.");
  });

  it("falls back to a generic basis when evidence_text is missing, without breaking the UI", () => {
    const result = baseResult(null);
    result.todos[0].evidence_text = undefined;

    const todos = buildGeneratedTodos(result);

    expect(todos[0].basis).toBe("회의록 후보 담당자: 곽진아");
  });
});

describe("deriveCurrentUserRole", () => {
  it("팀장 역할은 leader로 매핑된다", () => {
    expect(deriveCurrentUserRole("팀장")).toBe("leader");
  });

  it("심사자 역할은 reviewer로 매핑된다", () => {
    expect(deriveCurrentUserRole("심사자")).toBe("reviewer");
  });

  it("팀원 역할은 member로 매핑된다", () => {
    expect(deriveCurrentUserRole("팀원")).toBe("member");
  });

  it("역할 정보가 없으면(null/undefined) member로 폴백한다, 하드코딩된 leader로 기본값을 두지 않는다", () => {
    expect(deriveCurrentUserRole(null)).toBe("member");
    expect(deriveCurrentUserRole(undefined)).toBe("member");
  });
});

describe("MeetingsView 홈 탭", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockRecordingStatus = "idle";
    mockStartRecording.mockClear();
    mockUseAuth.mockReturnValue(asLeader());
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      { meetingId: "2", title: "미저장 준비회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: null,
      errorMessage: null,
      attendees: [],
    });
  });

  it("저장된 회의록 탭을 누르면 savedAt이 있는 회의록만 목록에 보인다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("저장된 정기회의").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(screen.getByText("저장된 정기회의")).toBeInTheDocument();
    expect(screen.queryByText("미저장 준비회의")).not.toBeInTheDocument();
  });

  it("수정 저장만 하고 AI 재분석이 끝나지 않은 버전은 분석/업로드 탭 목록에 보이지 않는다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      { meetingId: "6", title: "저장된 정기회의_수정본", meetingDate: "2026-07-23", meetingType: "정기회의", analysisStatus: "pending", savedAt: "2026-07-23T10:00:00", originalMeetingId: "1", tasksRegistered: false },
    ]);

    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    // 기본 탭이 분석/업로드다 — 재분석 전 버전은 여기 목록에 없어야 한다.
    await waitFor(() => expect(screen.getAllByText("저장된 정기회의").length).toBeGreaterThan(0));
    expect(screen.queryByText("저장된 정기회의_수정본")).not.toBeInTheDocument();
  });

  it("역할분배·업무등록이 안 된 저장 회의록에는 '등록완료' 배지가 보이지 않는다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("저장된 정기회의")).toBeInTheDocument();
    expect(screen.queryByText("등록완료")).not.toBeInTheDocument();
  });

  it("역할분배·업무등록이 완료된 저장 회의록에는 '등록완료' 배지가 보이고, 원본이면 '수정됨' 배지는 보이지 않는다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "3", title: "등록완료된 회의", meetingDate: "2026-07-21", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-21T10:00:00", originalMeetingId: null, tasksRegistered: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("등록완료")).toBeInTheDocument();
    expect(screen.queryByText("수정됨")).not.toBeInTheDocument();
  });

  it("수정본이면서 등록완료된 저장 회의록에는 '등록완료'와 '수정됨' 배지가 모두 보인다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "4", title: "수정된 회의", meetingDate: "2026-07-22", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-22T10:00:00", originalMeetingId: "3", tasksRegistered: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("등록완료")).toBeInTheDocument();
    expect(await screen.findByText("수정됨")).toBeInTheDocument();
  });

  it("저장된 회의록 카드를 클릭하면 분석결과가 아니라 회의록 원문이 보인다", async () => {
    const user = userEvent.setup();
    // selected 변경 시 실행되는 다른 useEffect도 fetchMeeting을 호출하므로, mockResolvedValueOnce가 아니라
    // mockResolvedValue로 모든 호출에 transcript를 포함한 응답을 주도록 한다.
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: null,
      errorMessage: null,
      attendees: [],
      transcript: "오늘 회의에서는 신규 기능을 논의했습니다.",
    });
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));
    await user.click(await screen.findByText("저장된 정기회의"));

    expect(await screen.findByText("오늘 회의에서는 신규 기능을 논의했습니다.")).toBeInTheDocument();
  });

  it("meetingId 쿼리파라미터가 있으면 저장 여부와 무관하게 분석/업로드 탭에서 해당 회의록 상세가 바로 보인다", async () => {
    // "1"은 beforeEach의 fetchMeetings 목록에서 savedAt이 있는(저장 확정된) 회의록이다.
    // "저장된 회의록" 탭은 목록만 보여주고 클릭해야 내용이 열리므로, 알림 바로가기로 온
    // 사용자에게는 상세가 곧장 뜨는 분석/업로드 탭으로 보내야 한다.
    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=1"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole("button", { name: "분석/업로드" })).toHaveClass("border-blue-600"));
    expect(screen.getByRole("button", { name: "저장된 회의록" })).not.toHaveClass("border-blue-600");
  });

  it("panel=todos 쿼리파라미터가 있으면 클릭 없이 바로 '역할 분배 검토' 탭으로 연결된다", async () => {
    // 팀장에게 역할분배를 요청하는 알림의 "바로가기"가 붙이는 panel=todos 쿼리를 재현한다.
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      errorMessage: null,
      attendees: [],
      analysis: {
        summary: "요약",
        decisions: [],
        risks: [],
        keywords: [],
        meeting_meta: { title: "저장된 정기회의", meeting_date: "2026-07-19", participants: [] },
        todos: [],
      },
    });

    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=1&panel=todos"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    // "생성된 To-Do"는 panelTab==="todos"일 때만 보이는 문구다 — 기본값인 요약 탭이 아니라
    // 클릭 없이 바로 이 탭으로 연결됐는지 확인한다. 상세 조회까지 기다려야 하므로,
    // 전체 스위트를 병렬로 돌릴 때의 지연을 견디도록 기본 타임아웃(1초)보다 넉넉히 준다.
    expect(await screen.findByText(/생성된 To-Do/, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("'업무로 등록'을 누르면 바로 등록하지 않고 '역할 분배 검토' 화면을 먼저 보여준다", async () => {
    const user = userEvent.setup();
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      errorMessage: null,
      attendees: [],
      analysis: {
        summary: "요약",
        decisions: [],
        risks: [],
        keywords: [],
        meeting_meta: { title: "저장된 정기회의", meeting_date: "2026-07-19", participants: [] },
        todos: [
          { title: "인증 구조 설계", description: "", assignee_candidate: "김민준", assignee_id: "1", due_date: "2026-07-20", priority: "HIGH", category: "BACKEND", needs_leader_review: false },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=1"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "업무로 등록" }));

    // 검토 화면으로만 전환되고, 아직 서버에 등록 요청은 나가지 않는다.
    expect(await screen.findByRole("heading", { name: "역할 분배 검토" })).toBeInTheDocument();
    expect(registerMeetingTasks).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /업무 보드에 등록/ }));

    await waitFor(() => expect(registerMeetingTasks).toHaveBeenCalledWith(
      "1",
      "1",
      [expect.objectContaining({ title: "인증 구조 설계", assignee_id: "1" })]
    ));
  });

  it("저장된 회의록에서 '업무로 등록'으로 들어간 역할 분배 검토 화면도 배정/미배정 요약이 실제 항목 수를 반영한다", async () => {
    const user = userEvent.setup();
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      errorMessage: null,
      attendees: [],
      analysis: {
        summary: "요약",
        decisions: [],
        risks: [],
        keywords: [],
        meeting_meta: { title: "저장된 정기회의", meeting_date: "2026-07-19", participants: [] },
        todos: [
          { title: "인증 구조 설계", description: "", assignee_candidate: "김민준", assignee_id: "1", due_date: "2026-07-20", priority: "HIGH", category: "BACKEND", needs_leader_review: false },
          { title: "테스트 케이스 작성", description: "", assignee_candidate: null, assignee_id: null, due_date: "2026-07-22", priority: "MEDIUM", category: "OTHER", needs_leader_review: true },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=1"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "업무로 등록" }));

    expect(await screen.findByRole("heading", { name: "역할 분배 검토" })).toBeInTheDocument();
    // 이 화면은 analysisResult가 아니라 저장된 meeting.todos를 변환해 채워지므로,
    // 요약 배지가 generatedTodos만 세면 항상 0으로 보이는 회귀를 막는다.
    expect(screen.getByText("1개 배정 완료")).toBeInTheDocument();
    expect(screen.getByText("1개 미배정")).toBeInTheDocument();
  });

  it("meetingId 쿼리파라미터의 회의록이 아직 저장되지 않았어도(savedAt null) 분석/업로드 탭으로 전환된다", async () => {
    // "2"는 beforeEach의 fetchMeetings 목록에서 savedAt: null(분석 완료, 저장 확정 전) 상태다.
    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=2"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole("button", { name: "분석/업로드" })).toHaveClass("border-blue-600"));
    expect(screen.getByRole("button", { name: "저장된 회의록" })).not.toHaveClass("border-blue-600");
  });

  it("meetingId 쿼리파라미터의 회의록이 수정본(버전)이면 저장된 회의록 탭으로 전환된다", async () => {
    // "6"은 originalMeetingId가 있는 버전이다 — 분석/업로드 탭이 아니라 저장된 회의록 탭으로 가야 한다.
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      { meetingId: "6", title: "저장된 정기회의_수정본", meetingDate: "2026-07-23", meetingType: "정기회의", analysisStatus: "pending", savedAt: "2026-07-23T10:00:00", originalMeetingId: "1", tasksRegistered: false },
    ]);
    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=6"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole("button", { name: "저장된 회의록" })).toHaveClass("border-blue-600"));
    expect(screen.getByRole("button", { name: "분석/업로드" })).not.toHaveClass("border-blue-600");
  });

  it("마이크 버튼을 누르면 startRecording을 호출한다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByTitle("회의 녹음 시작"));

    expect(mockStartRecording).toHaveBeenCalledTimes(1);
  });

  it("녹음 중에는 마이크 버튼이 비활성화된다", async () => {
    mockRecordingStatus = "recording";
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    expect(screen.getByTitle("회의 녹음 시작")).toBeDisabled();
  });
});

describe("MeetingsView 삭제 플로우 분리", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(asLeader());
    deleteMeetingAnalysis.mockResolvedValue({ meetingId: "1", status: "DELETED" });
    deleteMeeting.mockResolvedValue({ meetingId: "1", status: "DELETED" });
    // 목록에서 첫 회의록이 자동 선택되면서 상세 조회 effect가 fetchMeeting을 호출하므로 목업해둔다.
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: null,
      errorMessage: null,
      attendees: [],
    });
  });

  it("분석 완료된 회의록의 삭제 버튼을 누르면 '분석 결과 삭제' 확인 모달이 뜬다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));

    expect(await screen.findByText("분석 결과 삭제")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 결과만 삭제" })).toBeInTheDocument();
    expect(screen.getByText("분석 결과 + To-Do 삭제")).toBeInTheDocument();
  });

  it("To-Do가 생성된 분석 결과는 '분석 결과 + To-Do 삭제' 버튼이 활성화된다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false, hasGeneratedTodos: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));

    expect(await screen.findByRole("button", { name: "분석 결과 + To-Do 삭제" })).toBeEnabled();
  });

  it("To-Do가 생성되지 않은 분석 결과(팀원이 분석한 경우 등)는 '분석 결과 + To-Do 삭제' 버튼이 비활성화된다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false, hasGeneratedTodos: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));

    expect(await screen.findByRole("button", { name: "분석 결과 + To-Do 삭제" })).toBeDisabled();
  });

  it("'분석 결과만 삭제'를 누르면 분석/업로드 목록에서 카드가 바로 사라진다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));
    await user.click(await screen.findByRole("button", { name: "분석 결과만 삭제" }));

    await waitFor(() => expect(deleteMeetingAnalysis).toHaveBeenCalledWith("1", "1", false));
    expect(deleteMeeting).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("분석완료 회의")).not.toBeInTheDocument());
  });

  it("'분석 결과 + To-Do 삭제'를 눌러도 분석/업로드 목록에서 카드가 바로 사라진다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: true, hasGeneratedTodos: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));
    await user.click(await screen.findByRole("button", { name: "분석 결과 + To-Do 삭제" }));

    await waitFor(() => expect(deleteMeetingAnalysis).toHaveBeenCalledWith("1", "1", true));
    await waitFor(() => expect(screen.queryByText("분석완료 회의")).not.toBeInTheDocument());
  });

  // 서버가 분석 삭제를 'failed'로 표시하던 시절에는 새로고침하면 '분석 실패'로 되살아났다.
  it("서버가 analysis_deleted로 내려주면 새로고침해도 분석/업로드 목록에 다시 나타나지 않는다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석삭제된 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "analysis_deleted", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
    ]);
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("분석삭제된 회의")).not.toBeInTheDocument());
  });

  it("분석 전(pending/processing/failed) 회의록의 삭제 버튼은 기존처럼 전체 삭제(deleteMeeting) 확인 모달을 띄운다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "2", title: "분석중 회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "processing", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석중 회의 회의록 삭제"));

    expect(await screen.findByText("회의록 삭제")).toBeInTheDocument();
    await user.click(screen.getByText("삭제"));

    await waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith("1", "2", false));
    expect(deleteMeetingAnalysis).not.toHaveBeenCalled();
  });

  it("분석 결과 삭제 요청이 타임아웃되면 실패로 단정하지 않고 서버 목록을 다시 조회한다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    deleteMeetingAnalysis.mockRejectedValue(new ApiRequestError("요청이 너무 오래 걸려 중단되었습니다.", 0, "REQUEST_TIMEOUT"));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));
    await user.click(await screen.findByRole("button", { name: "분석 결과만 삭제" }));

    await waitFor(() => expect(deleteMeetingAnalysis).toHaveBeenCalledWith("1", "1", false));
    // 지연 문구로 사용자를 불안하게 만들지 않고 조용히 서버 상태만 다시 맞춘다.
    expect(screen.queryByText("삭제 확인이 지연되고 있습니다. 최신 상태를 다시 불러옵니다.")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(2));
  });

  // 서버의 409는 "이 회의록에 분석 결과가 이미 없다"는 사실 통보다. 사용자가 삭제로 원한 상태가
  // 이미 이뤄져 있으므로 에러로 알릴 게 아니라, 낡은 processed를 서버 사실에 맞춰야 한다.
  // 예전에는 토스트만 띄우고 카드를 그대로 둬서, 다시 눌러도 같은 문구가 반복됐다.
  it("분석 결과가 이미 없어 409가 오면 에러 문구 대신 목록에서 카드를 없앤다", async () => {
    fetchMeetings
      .mockResolvedValueOnce([
        { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
      ])
      .mockResolvedValueOnce([
        { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "analysis_deleted", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      ]);
    deleteMeetingAnalysis.mockRejectedValue(
      new ApiRequestError("삭제할 분석 결과가 없습니다.", 409, "MEETING_ANALYSIS_NOT_FOUND")
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByLabelText("분석완료 회의 분석 결과 삭제"));
    await user.click(await screen.findByRole("button", { name: "분석 결과만 삭제" }));

    await waitFor(() => expect(deleteMeetingAnalysis).toHaveBeenCalledWith("1", "1", false));
    await waitFor(() => expect(screen.queryByText("분석완료 회의")).not.toBeInTheDocument());
    expect(screen.queryByText("삭제할 분석 결과가 없습니다.")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(2));
  });

  it("전체 삭제 요청이 타임아웃돼도 서버가 실제로 삭제를 끝냈다면 재조회 후 목록에서 사라진다", async () => {
    fetchMeetings
      .mockResolvedValueOnce([
        { meetingId: "2", title: "분석중 회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "processing", savedAt: null, originalMeetingId: null, tasksRegistered: false },
      ])
      // 클라이언트가 타임아웃으로 실패를 봤지만, 서버는 실제로 삭제를 끝낸 상황을 재현한다.
      .mockResolvedValueOnce([]);
    deleteMeeting.mockRejectedValue(new ApiRequestError("요청이 너무 오래 걸려 중단되었습니다.", 0, "REQUEST_TIMEOUT"));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByLabelText("분석중 회의 회의록 삭제"));
    await user.click(screen.getByText("삭제"));

    await waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith("1", "2", false));
    expect(screen.queryByText("삭제 확인이 지연되고 있습니다. 최신 상태를 다시 불러옵니다.")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMeetings).toHaveBeenCalledTimes(2));
    // 서버 재조회 결과에 없는 항목이 로컬 캐시 때문에 되살아나면 안 된다.
    await waitFor(() => expect(screen.queryByText("분석중 회의")).not.toBeInTheDocument());
  });

  it("삭제를 누르면 서버 응답을 기다리지 않고 목록에서 즉시 사라진다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "2", title: "분석중 회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "processing", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    // 서버 응답이 끝내 오지 않아도 화면에서는 즉시 사라져야 한다.
    deleteMeeting.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석중 회의 회의록 삭제"));
    await user.click(screen.getByText("삭제"));

    await waitFor(() => expect(screen.queryByText("분석중 회의")).not.toBeInTheDocument());
  });

  it("서버 삭제가 권한 오류로 실패하면 목록에 되돌려 놓는다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "2", title: "분석중 회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "processing", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    deleteMeeting.mockRejectedValue(new ApiRequestError("권한이 없습니다.", 403));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석중 회의 회의록 삭제"));
    await user.click(screen.getByText("삭제"));

    expect(await screen.findByText("본인이 업로드한 회의록만 삭제할 수 있습니다.")).toBeInTheDocument();
    expect(await screen.findByText("분석중 회의")).toBeInTheDocument();
  });

  it("'저장된 회의록' 탭의 새 삭제 버튼은 원본 삭제(deleteMeeting)를 호출한다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "3", title: "저장된 회의", meetingDate: "2026-07-21", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-21T10:00:00", originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));
    await user.click(await screen.findByLabelText("저장된 회의 회의록 삭제"));

    expect(await screen.findByText("회의록 삭제")).toBeInTheDocument();
    await user.click(screen.getByText("삭제"));

    await waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith("1", "3", false));
    expect(deleteMeetingAnalysis).not.toHaveBeenCalled();
  });

  it("회의록 삭제 성공 시 sonner toast.success가 호출된다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "2", title: "분석중 회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "processing", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByLabelText("분석중 회의 회의록 삭제"));
    await user.click(screen.getByText("삭제"));

    await waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith("1", "2", false));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("회의록이 삭제되었습니다.");
  });
});

describe("MeetingsView 분석 결과 삭제 후 재분석", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(asLeader());
    retryMeetingAnalysis.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "PROCESSING",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: null,
      analysis: null,
      errorMessage: null,
      attendees: [],
      transcript: null,
    });
  });

  it("분석 실패 상태의 회의록을 선택하면 '재분석하기' 버튼이 보이고, 누르면 retryMeetingAnalysis를 호출한다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "실패한 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "failed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByText("실패한 회의"));

    await user.click(await screen.findByRole("button", { name: "재분석하기" }));

    await waitFor(() => expect(retryMeetingAnalysis).toHaveBeenCalledWith("1", "1"));
  });

  it("심사자에게는 분석 실패 상태의 회의록을 선택해도 '재분석하기' 버튼이 보이지 않는다", async () => {
    mockUseAuth.mockReturnValue(asReviewer());
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "실패한 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "failed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(await screen.findByText("실패한 회의"));

    expect(screen.queryByRole("button", { name: "재분석하기" })).not.toBeInTheDocument();
  });
});

describe("MeetingsView 대시보드 업로드 이어보기", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(asLeader());
    fetchMeetings.mockResolvedValue([]);
    fetchMeeting.mockResolvedValue({
      meetingId: "meeting-77",
      projectId: "1",
      status: "PROCESSING",
      sourceType: "document",
      fileName: "7차 정기회의.txt",
      analysisSource: null,
      analysis: null,
      errorMessage: null,
      attendees: [],
      transcript: null,
    });
  });

  it("resume 파라미터로 들어오면 업로드 모달을 다시 열지 않고 해당 회의의 분석 상태 폴링을 시작한다", async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/meetings?resume=meeting-77&title=7%EC%B0%A8%20%EC%A0%95%EA%B8%B0%ED%9A%8C%EC%9D%98&uploadedAt=2026-07-28T02%3A00%3A00.000Z"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeeting).toHaveBeenCalledWith("1", "meeting-77"));
    expect(screen.getByText("분석 중")).toBeInTheDocument();
    expect(screen.queryByText("업로드 유형 선택")).not.toBeInTheDocument();

    unmount();
  });
});

describe("MeetingsView PDF 내보내기", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockRecordingStatus = "idle";
    mockStartRecording.mockClear();
    mockUseAuth.mockReturnValue(asLeader());
    fetchMeetings.mockResolvedValue([]);
    analyzeMeeting.mockResolvedValue({
      meetingId: "M1",
      projectId: "1",
      status: "PROCESSING",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: null,
      analysis: null,
      errorMessage: null,
      attendees: [],
    });
    fetchMeeting.mockResolvedValue({
      meetingId: "M1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: baseResult("1"),
      errorMessage: null,
      attendees: [],
    });
  });

  // 시그니처 변경(ExportablePdfData 인자 도입) 후에도 PDF 버튼의 disabled 조건
  // (!analysisResult || isExportingPdf)은 리팩터 전후 동일하게 유지되어야 한다 — 회귀 방지용 특성화 테스트.
  it("기존 분석 직후 화면의 PDF 버튼은 여전히 activeResult 기준으로 활성화된다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await user.click(screen.getAllByRole("button", { name: "회의록 업로드" })[0]);
    await user.click(screen.getByText("문서 업로드"));
    await user.click(screen.getByRole("button", { name: /다음/ }));

    const file = new File(["dummy"], "meeting.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(await screen.findByRole("button", { name: /김민준/ }));
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /PDF 저장/ })).toBeInTheDocument(), { timeout: 5000 });

    expect(screen.getByRole("button", { name: /PDF 저장/ })).not.toBeDisabled();
  });

  it("사이드바에서 다시 연 회의록 상세 화면에도 PDF 버튼이 있고, 클릭하면 meeting.todos를 파싱해 내보낸다", async () => {
    // fetchMeetings로 이미 분석 완료된 회의록을 받으면 목록의 첫 항목이 자동 선택되고,
    // beforeEach에서 목업한 fetchMeeting(analysis 포함)이 상세 조회 effect에서 호출되어
    // meeting.summary가 채워진 상세 패널(사이드바 재조회 화면)이 뜬다.
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
    ]);
    // 목록의 meetingId("1")와 일치해야 상세 조회 effect가 이 회의록에 분석 결과를 반영한다.
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: baseResult("1"),
      errorMessage: null,
      attendees: [],
    });

    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    const pdfButton = await screen.findByRole("button", { name: "PDF로 저장" });
    expect(pdfButton).not.toBeDisabled();
    fireEvent.click(pdfButton);

    // buildExportDataFromMeeting이 meeting.todos("곽진아: 인증과 권한 구조 (07.12)")를
    // parseMeetingTodoLine으로 정확히 파싱해 넘겼는지 검증한다. html2canvas는 DOM 내용과
    // 무관하게 항상 고정된 캔버스를 반환하도록 목업돼 있으므로, 클릭이 pdf.save까지
    // 도달하는지만으로는 assigneeName/title이 뒤바뀌는 회귀를 잡을 수 없다. 대신 캡처
    // 영역 템플릿이 렌더링하는 "{title} - {assigneeName} ({dueDate})" 조합 텍스트가
    // (클릭 직후 pdfExportData가 채워진 시점에) DOM에 실제로 나타나는지 확인한다.
    expect(screen.getByText("인증과 권한 구조 - 곽진아 (07.12)")).toBeInTheDocument();

    await waitFor(() => expect(mockPdfSave).toHaveBeenCalled());
  });

  // 상세 패널의 PDF 버튼에는 pdfExportMessage 출력 자리가 없어서 실패가 조용히 묻혔다.
  it("사이드바 상세 화면에서 PDF 생성이 실패하면 오류 메시지를 화면에 보여준다", async () => {
    const html2canvas = (await import("html2canvas")).default;
    vi.mocked(html2canvas).mockRejectedValueOnce(new Error("canvas failure"));

    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "분석완료 회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
    ]);
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: baseResult("1"),
      errorMessage: null,
      attendees: [],
    });

    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "PDF로 저장" }));

    expect(await screen.findByText(/PDF 생성 중 오류가 발생했습니다/)).toBeInTheDocument();
  });
});
