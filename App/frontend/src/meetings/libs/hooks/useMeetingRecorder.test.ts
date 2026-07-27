import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeetingRecorder } from "./useMeetingRecorder";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: MediaStream) {
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

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

describe("useMeetingRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(createMockStream()) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("start()를 호출하면 권한 요청을 거쳐 recording 상태가 되고 1초마다 elapsedSeconds가 증가한다", async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("recording");
    expect(result.current.elapsedSeconds).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedSeconds).toBe(3);
  });

  it("getUserMedia가 실패하면 error 상태와 사용자 노출 메시지를 설정한다", async () => {
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("마이크");
  });

  it("stop()은 녹음된 청크를 하나의 Blob으로 합쳐 반환하고 상태를 stopped로 바꾼다", async () => {
    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    let recorded: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      recorded = await result.current.stop();
    });

    expect(recorded).not.toBeNull();
    expect(recorded?.mimeType).toBe("audio/webm");
    expect(result.current.status).toBe("stopped");
  });

  it("이미 recording 상태에서 start()를 다시 호출해도 새 스트림을 요청하지 않는다", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(createMockStream());
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
