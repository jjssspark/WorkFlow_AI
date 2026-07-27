import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { RecordingSaveModal } from "./RecordingSaveModal";
import { useRecordingSession } from "../libs/hooks/RecordingSessionProvider";
import { useAuth } from "../../global/hooks/useAuth";
import { getProjectMembers } from "../../global/api/projectsApi";
import { analyzeMeeting } from "../libs/utils/meetingAiApi";

vi.mock("../libs/hooks/RecordingSessionProvider", () => ({ useRecordingSession: vi.fn() }));
vi.mock("../../global/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../global/api/projectsApi", () => ({ getProjectMembers: vi.fn() }));
vi.mock("../libs/utils/meetingAiApi", () => ({ analyzeMeeting: vi.fn() }));

const mockedUseRecordingSession = vi.mocked(useRecordingSession);
const mockedUseAuth = vi.mocked(useAuth);
const mockedGetProjectMembers = vi.mocked(getProjectMembers);
const mockedAnalyzeMeeting = vi.mocked(analyzeMeeting);

describe("RecordingSaveModal", () => {
  const clearPendingBlob = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({ currentProjectId: 1 } as ReturnType<typeof useAuth>);
    mockedGetProjectMembers.mockResolvedValue([
      { userId: 10, name: "김민준", role: "MEMBER" } as Awaited<ReturnType<typeof getProjectMembers>>[number],
    ]);
  });

  it("pendingBlob이 없으면 아무것도 렌더링하지 않는다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "idle", elapsedSeconds: 0, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob,
    });
    const { container } = render(<RecordingSaveModal />, { wrapper: MemoryRouter });
    expect(container).toBeEmptyDOMElement();
  });

  it("저장 확인 시 analyzeMeeting을 sourceType audio와 webm 확장자 파일로 호출한다", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", elapsedSeconds: 12, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: "audio/webm" }), mimeType: "audio/webm" },
      clearPendingBlob,
    });
    mockedAnalyzeMeeting.mockResolvedValue({} as Awaited<ReturnType<typeof analyzeMeeting>>);
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "주간 회의" } });
    fireEvent.click(screen.getByText("김민준"));
    fireEvent.click(screen.getByRole("button", { name: "저장 및 분석 시작" }));

    await waitFor(() => expect(mockedAnalyzeMeeting).toHaveBeenCalledTimes(1));
    const call = mockedAnalyzeMeeting.mock.calls[0][0];
    expect(call.sourceType).toBe("audio");
    expect(call.file?.name.endsWith(".webm")).toBe(true);
    expect(call.participants).toEqual(["김민준"]);
    expect(clearPendingBlob).toHaveBeenCalledTimes(1);
  });

  it("analyzeMeeting이 실패하면 에러 메시지를 보여주고 pendingBlob을 유지한다(clearPendingBlob 미호출)", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", elapsedSeconds: 12, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: "audio/webm" }), mimeType: "audio/webm" },
      clearPendingBlob,
    });
    mockedAnalyzeMeeting.mockRejectedValue(new Error("network error"));
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "주간 회의" } });
    fireEvent.click(screen.getByText("김민준"));
    fireEvent.click(screen.getByRole("button", { name: "저장 및 분석 시작" }));

    await waitFor(() => expect(screen.getByText(/분석 요청에 실패했습니다/)).toBeInTheDocument());
    expect(clearPendingBlob).not.toHaveBeenCalled();
  });
});
