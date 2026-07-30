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
      { userId: 10, name: "김민준", email: "kim@test.com", role: "팀원" },
    ]);
  });

  it("pendingBlob이 없으면 아무것도 렌더링하지 않는다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "idle", error: null,
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob,
    });
    const { container } = render(<RecordingSaveModal />, { wrapper: MemoryRouter });
    expect(container).toBeEmptyDOMElement();
  });

  it("저장 확인 시 analyzeMeeting을 sourceType audio와 webm 확장자 파일로 호출한다", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
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

  // 실제 브라우저는 코덱 파라미터가 붙은 mimeType을 돌려준다(Chrome: "audio/webm;codecs=opus",
  // Firefox: "audio/ogg; codecs=opus"). 정확 일치 조회로는 매칭되지 않아 확장자가 어긋난다.
  it.each([
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/ogg; codecs=opus", ".ogg"],
    ["audio/mp4", ".m4a"],
  ])("mimeType %s는 %s 확장자 파일로 업로드한다", async (mimeType, extension) => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: mimeType }), mimeType },
      clearPendingBlob,
    });
    mockedAnalyzeMeeting.mockResolvedValue({} as Awaited<ReturnType<typeof analyzeMeeting>>);
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "주간 회의" } });
    fireEvent.click(screen.getByText("김민준"));
    fireEvent.click(screen.getByRole("button", { name: "저장 및 분석 시작" }));

    await waitFor(() => expect(mockedAnalyzeMeeting).toHaveBeenCalledTimes(1));
    expect(mockedAnalyzeMeeting.mock.calls[0][0].file?.name.endsWith(extension)).toBe(true);
  });

  // 취소는 녹음 원본을 되돌릴 수 없게 버리는 동작이므로 한 번의 오클릭으로 실행되면 안 된다.
  it("취소를 한 번 누르면 녹음을 지우지 않고 확인 문구를 먼저 보여준다", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: "audio/webm" }), mimeType: "audio/webm" },
      clearPendingBlob,
    });
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(clearPendingBlob).not.toHaveBeenCalled();
    expect(screen.getByText(/정말 취소하시겠습니까/)).toBeInTheDocument();
  });

  it("취소 확인 후 '예, 취소'를 누르면 그때 clearPendingBlob이 호출된다", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: "audio/webm" }), mimeType: "audio/webm" },
      clearPendingBlob,
    });
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "예, 취소" }));

    expect(clearPendingBlob).toHaveBeenCalledTimes(1);
  });

  it("'계속 작성'을 누르면 녹음을 유지한 채 원래 폼으로 돌아간다", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
      startRecording: vi.fn(), requestStop: vi.fn(),
      pendingBlob: { blob: new Blob(["x"], { type: "audio/webm" }), mimeType: "audio/webm" },
      clearPendingBlob,
    });
    render(<RecordingSaveModal />, { wrapper: MemoryRouter });

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));

    expect(clearPendingBlob).not.toHaveBeenCalled();
    expect(screen.queryByText(/정말 취소하시겠습니까/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 및 분석 시작" })).toBeInTheDocument();
  });

  it("analyzeMeeting이 실패하면 에러 메시지를 보여주고 pendingBlob을 유지한다(clearPendingBlob 미호출)", async () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "stopped", error: null,
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
