import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeetingRecorder } from "./useMeetingRecorder";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

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

  // 백그라운드 탭에서는 setInterval이 throttle돼 tick 횟수가 실제 경과 시간보다 적어진다.
  // 카운터 증가 방식이면 표시 시간이 뒤처지므로, 시작 시각 기준으로 계산해야 한다.
  it("타이머 tick이 밀려도 경과 시간은 실제 시각 기준으로 계산한다", async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });

    // tick 한 번이 발생하는 사이에 시스템 시각은 10초 흐른 상황(백그라운드 throttle) 재현
    act(() => {
      vi.setSystemTime(Date.now() + 10_000);
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.elapsedSeconds).toBe(11);
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

  it("동기적으로 start()를 두 번 호출해도 getUserMedia를 한 번만 호출한다 (same-tick race 방지)", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(createMockStream());
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      // 두 개의 Promise를 동시에 시작 (await 없이)
      const p1 = result.current.start();
      const p2 = result.current.start();
      // 둘 다 완료될 때까지 기다림
      await Promise.all([p1, p2]);
    });

    // getUserMedia는 정확히 한 번만 호출되어야 함
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  // MediaRecorder가 스스로 inactive가 된 뒤(장치 분리, 트랙 종료 등) stop()이 불리면
  // 이전에는 busy 가드와 status를 그대로 둔 채 early return해 훅이 영구히 잠겼다.
  it("stop() 시 recorder가 이미 inactive면 status를 idle로 되돌려 복구 가능한 상태로 만든다", async () => {
    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("recording");

    // 기저 MediaRecorder가 외부 요인으로 스스로 종료된 상황을 재현
    MockMediaRecorder.instances[0].state = "inactive";

    let recorded: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      recorded = await result.current.stop();
    });

    expect(recorded).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("잠긴 상태에서 stop() 후 다시 start()를 호출하면 정상적으로 녹음이 재개된다", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(createMockStream());
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });
    MockMediaRecorder.instances[0].state = "inactive";
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("recording");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("녹음 도중 MediaRecorder가 onerror를 발생시키면 error 상태와 사용자 메시지를 설정한다", async () => {
    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      MockMediaRecorder.instances[0].onerror?.();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeTruthy();
  });

  it("unmount 시에 타이머와 스트림 트랙이 정리된다", async () => {
    const stream = createMockStream();
    const mockTrack = stream.getTracks()[0];
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    const { result, unmount } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.start();
    });

    // 타이머가 활성화되어 있는지 확인
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSeconds).toBe(1);

    // unmount
    unmount();

    // unmount 후 타이머가 동작하지 않아야 함
    const previousElapsed = result.current.elapsedSeconds;
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // interval이 실제로 해제됐는지 검증 — 해제되지 않았다면 elapsedSeconds가 계속 증가한다
    expect(result.current.elapsedSeconds).toBe(previousElapsed);

    // 트랙이 stop 호출되었는지 확인
    expect(mockTrack.stop).toHaveBeenCalled();
  });
});
