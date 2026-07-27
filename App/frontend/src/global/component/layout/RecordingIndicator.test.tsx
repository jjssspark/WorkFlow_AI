import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { RecordingIndicator } from "./RecordingIndicator";
import { useRecordingSession } from "../../../meetings/libs/hooks/RecordingSessionProvider";

vi.mock("../../../meetings/libs/hooks/RecordingSessionProvider", () => ({
  useRecordingSession: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const mockedUseRecordingSession = vi.mocked(useRecordingSession);
const mockedToastError = vi.mocked(toast.error);

describe("RecordingIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status가 recording이 아니면 아무것도 렌더링하지 않는다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "idle", elapsedSeconds: 0, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob: vi.fn(),
    });
    const { container } = render(<RecordingIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("recording 중에는 mm:ss 타이머와 종료 버튼을 보여주고 클릭 시 requestStop을 호출한다", () => {
    const requestStop = vi.fn();
    mockedUseRecordingSession.mockReturnValue({
      status: "recording", elapsedSeconds: 65, error: null,
      startRecording: vi.fn(), requestStop, pendingBlob: null, clearPendingBlob: vi.fn(),
    });
    render(<RecordingIndicator />);

    expect(screen.getByText("01:05")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "녹화 종료" }));
    expect(requestStop).toHaveBeenCalledTimes(1);
  });

  it("1시간을 넘긴 녹화는 h:mm:ss 형식으로 표시한다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "recording", elapsedSeconds: 3723, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob: vi.fn(),
    });
    render(<RecordingIndicator />);

    expect(screen.getByText("1:02:03")).toBeInTheDocument();
  });

  it("status가 error이면 error 메시지를 토스트로 사용자에게 노출한다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "error", elapsedSeconds: 0, error: "마이크 권한을 확인할 수 없습니다.",
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob: vi.fn(),
    });
    render(<RecordingIndicator />);

    expect(mockedToastError).toHaveBeenCalledWith("마이크 권한을 확인할 수 없습니다.");
  });

  it("error가 아닌 상태에서는 토스트를 띄우지 않는다", () => {
    mockedUseRecordingSession.mockReturnValue({
      status: "recording", elapsedSeconds: 3, error: null,
      startRecording: vi.fn(), requestStop: vi.fn(), pendingBlob: null, clearPendingBlob: vi.fn(),
    });
    render(<RecordingIndicator />);

    expect(mockedToastError).not.toHaveBeenCalled();
  });
});
