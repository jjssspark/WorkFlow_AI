import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingSessionProvider, useRecordingElapsedSeconds, useRecordingSession } from "./RecordingSessionProvider";

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

  // 경과 시간은 별도 컨텍스트로 분리돼 있다. 세션 컨텍스트 "값 객체 자체"의 identity가
  // tick 사이에 유지돼야만, 시간을 쓰지 않는 소비자(MeetingsView 등)가 매초 리렌더되지 않는다.
  // 콜백 identity만 검사하면 값 객체가 매초 새로 만들어지는 경우를 잡지 못한다.
  it("녹음 중 경과 시간이 갱신돼도 세션 컨텍스트 값의 identity는 유지된다", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(
        () => ({ session: useRecordingSession(), elapsed: useRecordingElapsedSeconds() }),
        { wrapper: ({ children }) => <RecordingSessionProvider>{children}</RecordingSessionProvider> },
      );

      await act(async () => {
        await result.current.session.startRecording();
      });

      const sessionBefore = result.current.session;

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.elapsed).toBe(3);
      expect(result.current.session).toBe(sessionBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("녹음 종료 후 저장 전(pendingBlob 보유) 구간에도 새로고침 경고가 유지된다", async () => {
    // 저장 모달에서 제목·참석자를 입력하는 동안 새로고침하면 메모리의 원본이 사라진다.
    // 이 구간이 경고 대상에서 빠지면 사용자가 긴 회의 녹음을 조용히 잃는다.
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
    expect(result.current.status).not.toBe("recording");

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);
  });

  it("저장이 끝나 pendingBlob이 비면 새로고침 경고를 해제한다", async () => {
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

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(false);
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
