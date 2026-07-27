import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordingIndicator } from "./RecordingIndicator";
import { useRecordingSession } from "../../../meetings/libs/hooks/RecordingSessionProvider";

vi.mock("../../../meetings/libs/hooks/RecordingSessionProvider", () => ({
  useRecordingSession: vi.fn(),
}));

const mockedUseRecordingSession = vi.mocked(useRecordingSession);

describe("RecordingIndicator", () => {
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
});
