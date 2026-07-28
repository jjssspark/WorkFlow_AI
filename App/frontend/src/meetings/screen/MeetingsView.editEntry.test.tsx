import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MeetingsView } from "./MeetingsView";

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn().mockResolvedValue([
    { userId: 1, name: "김민준", email: "leader@test.com", role: "팀장" },
  ]),
}));

vi.mock("../libs/hooks/RecordingSessionProvider", () => ({
  useRecordingSession: () => ({
    status: "idle",
    error: null,
    startRecording: vi.fn(),
    requestStop: vi.fn(),
    pendingBlob: null,
    clearPendingBlob: vi.fn(),
  }),
}));

const fetchMeetings = vi.fn();
const fetchMeeting = vi.fn();
const createMeetingVersion = vi.fn();
const reanalyzeMeeting = vi.fn();

vi.mock("../libs/utils/meetingAiApi", () => ({
  analyzeMeeting: vi.fn(),
  confirmMeetingSave: vi.fn(),
  fetchMeeting: (...args: unknown[]) => fetchMeeting(...args),
  fetchMeetings: (...args: unknown[]) => fetchMeetings(...args),
  deleteMeeting: vi.fn(),
  retryMeetingAnalysis: vi.fn(),
  registerMeetingTasks: vi.fn(),
  createMeetingVersion: (...args: unknown[]) => createMeetingVersion(...args),
  reanalyzeMeeting: (...args: unknown[]) => reanalyzeMeeting(...args),
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

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/meetings"]}>
      <MeetingsView />
    </MemoryRouter>
  );
}

async function openSavedTab(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "저장된 회의록" }));
}

describe("MeetingsView 저장된 회의록 수정 진입점", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(asLeader());
    fetchMeetings.mockResolvedValue([
      {
        meetingId: "1",
        title: "저장된 정기회의",
        meetingDate: "2026-07-19",
        meetingType: "정기회의",
        analysisStatus: "completed",
        savedAt: "2026-07-19T10:00:00",
        originalMeetingId: null,
        tasksRegistered: false,
      },
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
      transcript: "실제 회의록 원문 내용입니다.",
    });
  });

  it("팀장은 저장된 회의록 카드에서 '수정' 버튼으로 수정 화면에 진입할 수 있다", async () => {
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);
    await screen.findByText("저장된 정기회의");

    await user.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석하기" })).toBeInTheDocument();
  });

  it("'수정' 클릭 시 회의록 상세를 조회해 실제 원문을 textarea에 채운다", async () => {
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);
    await screen.findByText("저장된 정기회의");

    await user.click(screen.getByRole("button", { name: "수정" }));

    expect(fetchMeeting).toHaveBeenCalledWith("1", "1");
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("실제 회의록 원문 내용입니다.")
    );
  });

  it("심사자에게는 저장된 회의록 카드에 '수정' 버튼이 보이지 않는다", async () => {
    mockUseAuth.mockReturnValue(asReviewer());
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);
    await screen.findByText("저장된 정기회의");

    expect(screen.queryByRole("button", { name: "수정" })).not.toBeInTheDocument();
  });

  it("수정 화면에서 저장이 완료되면 화면이 닫히고 회의록 목록을 다시 조회한다", async () => {
    createMeetingVersion.mockResolvedValue({ meetingId: "5", status: "SAVED" });
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);
    await screen.findByText("저장된 정기회의");
    await user.click(screen.getByRole("button", { name: "수정" }));

    const callsBeforeSave = fetchMeetings.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMeetings.mock.calls.length).toBeGreaterThan(callsBeforeSave));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // 수정 저장 후 목록이 새로고침 없이 바로 갱신돼야 한다.
  it("저장된 회의록을 수정 저장하면 새 수정본이 목록에 바로 나타난다", async () => {
    createMeetingVersion.mockResolvedValue({ meetingId: "7", status: "SAVED" });
    fetchMeetings
      .mockResolvedValueOnce([
        { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      ])
      .mockResolvedValue([
        { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
        { meetingId: "7", title: "저장된 정기회의_수정본", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "pending", savedAt: "2026-07-27T10:00:00", originalMeetingId: "1", tasksRegistered: false },
      ]);
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);
    await screen.findByText("저장된 정기회의");
    await user.click(screen.getByRole("button", { name: "수정" }));

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장된 정기회의_수정본")).toBeInTheDocument();
  });

  it("original_meeting_id가 있고 분석이 아직 대기 중(pending)인 버전에는 'AI 재분석하기' 버튼이 보인다", async () => {
    fetchMeetings.mockResolvedValue([
      {
        meetingId: "6",
        title: "저장된 정기회의_수정본",
        meetingDate: "2026-07-23",
        meetingType: "정기회의",
        analysisStatus: "pending",
        savedAt: "2026-07-23T10:00:00",
        originalMeetingId: "1",
        tasksRegistered: false,
      },
    ]);
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);

    expect(await screen.findByRole("button", { name: "AI 재분석하기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수정" })).not.toBeInTheDocument();
  });

  it("pending 버전에서 'AI 재분석하기' 클릭 시 편집 화면 대신 분석 화면을 띄우고 재분석을 요청한다", async () => {
    fetchMeetings.mockResolvedValue([
      {
        meetingId: "6",
        title: "저장된 정기회의_수정본",
        meetingDate: "2026-07-23",
        meetingType: "정기회의",
        analysisStatus: "pending",
        savedAt: "2026-07-23T10:00:00",
        originalMeetingId: "1",
        tasksRegistered: false,
      },
    ]);
    reanalyzeMeeting.mockResolvedValue({ meetingId: "6", status: "PROCESSING" });
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);

    await user.click(await screen.findByRole("button", { name: "AI 재분석하기" }));

    expect(reanalyzeMeeting).toHaveBeenCalledWith("1", "6");
    // 신규 업로드/재시도와 동일한 분석 화면(uploadFlow: "analyzing")으로 전환되어야 하며,
    // 그 화면은 pollMeetingStatus를 통해 fetchMeeting으로 상태를 조회한다.
    await waitFor(() => expect(fetchMeeting).toHaveBeenCalledWith("1", "6"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장된 회의록" })).not.toBeInTheDocument();
  });

  it("failed 상태인 버전에도 'AI 재분석하기' 버튼이 보인다", async () => {
    fetchMeetings.mockResolvedValue([
      {
        meetingId: "6",
        title: "저장된 정기회의_수정본",
        meetingDate: "2026-07-23",
        meetingType: "정기회의",
        analysisStatus: "failed",
        savedAt: "2026-07-23T10:00:00",
        originalMeetingId: "1",
        tasksRegistered: false,
      },
    ]);
    const user = userEvent.setup();
    renderView();
    await openSavedTab(user);

    expect(await screen.findByRole("button", { name: "AI 재분석하기" })).toBeInTheDocument();
  });
});
