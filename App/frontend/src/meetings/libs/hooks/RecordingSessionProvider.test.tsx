import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingSessionProvider, useRecordingSession } from "./RecordingSessionProvider";

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {}
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function createMockStream(): MediaStream {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

describe("RecordingSessionProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(createMockStream()) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requestStop()을 호출하면 녹음을 멈추고 pendingBlob을 채운다", async () => {
    const { result } = renderHook(() => useRecordingSession(), {
      wrapper: ({ children }) => <RecordingSessionProvider>{children}</RecordingSessionProvider>,
    });

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.status).toBe("recording");

    act(() => {
      result.current.requestStop();
    });

    await waitFor(() => expect(result.current.pendingBlob).not.toBeNull());
  });

  it("clearPendingBlob()을 호출하면 pendingBlob이 null로 초기화된다", async () => {
    const { result } = renderHook(() => useRecordingSession(), {
      wrapper: ({ children }) => <RecordingSessionProvider>{children}</RecordingSessionProvider>,
    });

    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      result.current.requestStop();
    });
    await waitFor(() => expect(result.current.pendingBlob).not.toBeNull());

    act(() => {
      result.current.clearPendingBlob();
    });

    expect(result.current.pendingBlob).toBeNull();
  });
});
