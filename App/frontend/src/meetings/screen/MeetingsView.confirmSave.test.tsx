import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MeetingsView } from "./MeetingsView";
import { ApiRequestError } from "../../global/api/apiClient";
import type { MeetingAiResult } from "../libs/types/meetingAiTypes";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, email: "leader@test.com", name: "김민준" },
    projectRoles: [{ projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" }],
    currentProjectId: 1,
    currentProject: { projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" },
    logout: vi.fn(),
  }),
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

const analyzeMeeting = vi.fn();
const confirmMeetingSave = vi.fn();
const fetchMeeting = vi.fn();
const fetchMeetings = vi.fn();
const deleteMeeting = vi.fn();
const retryMeetingAnalysis = vi.fn();
const registerMeetingTasks = vi.fn();

vi.mock("../libs/utils/meetingAiApi", () => ({
  analyzeMeeting: (...args: unknown[]) => analyzeMeeting(...args),
  confirmMeetingSave: (...args: unknown[]) => confirmMeetingSave(...args),
  fetchMeeting: (...args: unknown[]) => fetchMeeting(...args),
  fetchMeetings: (...args: unknown[]) => fetchMeetings(...args),
  deleteMeeting: (...args: unknown[]) => deleteMeeting(...args),
  retryMeetingAnalysis: (...args: unknown[]) => retryMeetingAnalysis(...args),
  registerMeetingTasks: (...args: unknown[]) => registerMeetingTasks(...args),
}));

const analysisResult: MeetingAiResult = {
  summary: "요약",
  decisions: [],
  risks: [],
  keywords: [],
  meeting_meta: { title: "정기회의", meeting_date: "2026-07-09", participants: ["김민준"] },
  todos: [],
};

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/meetings"]}>
      <MeetingsView />
    </MemoryRouter>
  );
}

async function analyzeAndReachResults() {
  const user = userEvent.setup();
  renderView();

  await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

  await user.click(screen.getAllByRole("button", { name: "회의록 업로드" })[0]);
  await user.click(screen.getByText("문서 업로드"));
  await user.click(screen.getByRole("button", { name: /다음/ }));

  const file = new File(["dummy"], "meeting.txt", { type: "text/plain" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, file);

  await user.click(await screen.findByRole("button", { name: /김민준/ }));
  await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));

  await waitFor(() => expect(screen.getByText("회의록 분석결과 저장")).toBeInTheDocument(), { timeout: 5000 });
  return user;
}

describe("MeetingsView handleConfirmSave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
      analysis: analysisResult,
      errorMessage: null,
      attendees: [],
    });
  });

  it("참석자를 1명도 선택하지 않으면 경고를 표시하고 분석을 시작하지 않는다", async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await user.click(screen.getAllByRole("button", { name: "회의록 업로드" })[0]);
    await user.click(screen.getByText("문서 업로드"));
    await user.click(screen.getByRole("button", { name: /다음/ }));

    const file = new File(["dummy"], "meeting.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));

    expect(await screen.findByText("참석자를 1명 이상 선택해주세요.")).toBeInTheDocument();
    expect(analyzeMeeting).not.toHaveBeenCalled();
  });

  it("서버 저장 확정(confirmMeetingSave)이 실패하면 사용자에게 에러를 노출한다", async () => {
    confirmMeetingSave.mockRejectedValue(new ApiRequestError("서버 저장에 실패했습니다.", 500));

    const user = await analyzeAndReachResults();
    await user.click(screen.getByText("회의록 분석결과 저장"));

    expect(await screen.findByText(/서버 저장에 실패했습니다/)).toBeInTheDocument();
    expect(confirmMeetingSave).toHaveBeenCalledWith("1", "M1");
  });

  // 저장 직후 진행 중이던 재조회 응답이 아직 saved_at을 담지 못하면, 방금 저장한 회의록이
  // 저장된 회의록 목록에서 사라져 "새로고침해야 뜬다"는 증상이 된다.
  it("저장 직후 재조회가 savedAt을 반영하지 못해도 저장 상태가 유지되고, 다시 저장하면 이미 저장됨을 알린다", async () => {
    confirmMeetingSave.mockResolvedValue({ meetingId: "M1", status: "SAVED" });
    fetchMeetings.mockResolvedValue([
      { meetingId: "M1", title: "정기회의", meetingDate: "2026-07-09", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);

    const user = await analyzeAndReachResults();
    const callsBeforeSave = fetchMeetings.mock.calls.length;
    await user.click(screen.getByText("회의록 분석결과 저장"));

    await waitFor(() => expect(confirmMeetingSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMeetings.mock.calls.length).toBeGreaterThan(callsBeforeSave));

    // savedAt이 재조회로 지워졌다면 여기서 서버를 다시 호출해버린다.
    await user.click(screen.getByText("회의록 분석결과 저장"));

    expect(await screen.findByText("이미 저장된 회의록입니다. 저장된 회의록 탭에서 확인할 수 있습니다.")).toBeInTheDocument();
    expect(confirmMeetingSave).toHaveBeenCalledTimes(1);
  });

  it("서버 저장 확정이 성공하면 에러 메시지가 노출되지 않는다", async () => {
    confirmMeetingSave.mockResolvedValue({ meetingId: "M1", status: "SAVED" });

    const user = await analyzeAndReachResults();
    await user.click(screen.getByText("회의록 분석결과 저장"));

    await waitFor(() => expect(confirmMeetingSave).toHaveBeenCalledWith("1", "M1"));
    expect(screen.getByText("회의록이 저장되었습니다.")).toBeInTheDocument();
  });
});
