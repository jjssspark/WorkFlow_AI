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

  // 실제 MediaRecorder는 timeslice를 주지 않으면 stop() 시점에만 dataavailable을 발생시킨다.
  timeslice: number | undefined;

  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
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

    // interval이 실제로 해제됐는지 검증한다. 언마운트 뒤에는 result.current가 더 이상
    // 갱신되지 않으므로 elapsedSeconds 비교로는 정리 실패를 잡을 수 없다 — 남은 타이머 수로 확인한다.
    expect(vi.getTimerCount()).toBe(0);

    // 트랙이 stop 호출되었는지 확인
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it("종료 버튼을 연속으로 눌러 stop()이 겹쳐 호출돼도 녹음 내용이 유실되지 않는다", async () => {
    // 실제 MediaRecorder는 stop() 시 state를 동기적으로 inactive로 바꾸고 onstop은 이후에 발화한다.
    // 그 간극에 두 번째 stop()이 chunksRef를 비우면 첫 호출이 빈 Blob을 만든다.
    class DeferredStopRecorder extends MockMediaRecorder {
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
        // 가짜 타이머는 queueMicrotask까지 가로채므로 네이티브 promise 마이크로태스크를 쓴다.
        void Promise.resolve().then(() => this.onstop?.());
      }
    }
    vi.stubGlobal("MediaRecorder", DeferredStopRecorder);

    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    let first: Awaited<ReturnType<typeof result.current.stop>> = null;
    let second: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      const firstCall = result.current.stop();
      const secondCall = result.current.stop();
      [first, second] = await Promise.all([firstCall, secondCall]);
    });

    expect(second).toBeNull();
    expect(first).not.toBeNull();
    expect(first!.blob.size).toBeGreaterThan(0);
  });

  it("stop() 대기 중 오류가 나도 종료 요청이 매듭지어지고 이후 녹음도 종료할 수 있다", async () => {
    // stop()이 onstop을 기다리는 사이에 onerror가 발화하면(장치 분리 등) 대기 중인
    // Promise가 영영 resolve되지 않아 종료 요청이 멈추고, 종료 가드가 잠긴 채 남아
    // 다음 녹음마저 종료할 수 없게 된다.
    class ErrorWhileStoppingRecorder extends MockMediaRecorder {
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
        void Promise.resolve().then(() => this.onerror?.());
      }
    }
    vi.stubGlobal("MediaRecorder", ErrorWhileStoppingRecorder);

    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    let stopped: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      stopped = await result.current.stop();
    });

    expect(result.current.status).toBe("error");
    // 오류 시점까지 모인 청크는 살려서 돌려준다
    expect(stopped).not.toBeNull();

    // 종료 가드가 잠기지 않아 다음 녹음은 정상적으로 종료돼야 한다
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    await act(async () => {
      await result.current.start();
    });
    let second: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      second = await result.current.stop();
    });
    expect(second).not.toBeNull();
    expect(result.current.status).toBe("stopped");
  });

  it("주기적으로 청크를 받도록 timeslice를 지정해 시작한다", async () => {
    // timeslice 없이 시작하면 dataavailable이 stop() 시점에 한 번만 발생해, 정상 종료 전
    // 오류가 나면 살릴 청크가 하나도 없다. 복구 경로가 실제로 동작하려면 이 인자가 필수다.
    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    const recorder = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
    expect(recorder.timeslice).toBeGreaterThan(0);
  });

  it("stop()이 동기적으로 예외를 던져도 마이크를 정리하고 세션이 잠기지 않는다", async () => {
    // recorder.stop()이 InvalidStateError 등을 던지면 정리 없이 빠져나가 마이크가 남고
    // busy 가드가 잠긴 채 남아 다시 녹음할 수 없게 된다.
    class ThrowingStopRecorder extends MockMediaRecorder {
      stop(): void {
        throw new Error("InvalidStateError");
      }
    }
    vi.stubGlobal("MediaRecorder", ThrowingStopRecorder);

    const mockTrack = { stop: vi.fn() };
    const getUserMedia = vi
      .fn()
      .mockResolvedValue({ getTracks: () => [mockTrack] } as unknown as MediaStream);
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    let stopped: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => {
      stopped = await result.current.stop();
    });

    expect(stopped).toBeNull();
    expect(result.current.status).toBe("error");
    expect(mockTrack.stop).toHaveBeenCalled();

    // 세션이 잠기지 않아 다시 녹음을 시작할 수 있어야 한다
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("recording");
  });

  it("녹음 중 오류로 중단되면 대기 중인 stop()이 없어도 살려낸 원본을 콜백으로 넘긴다", async () => {
    // 녹음 중 오류는 대개 대기 중인 stop()이 없다. 이때 살려낸 원본을 전달하지 않으면
    // 긴 회의 녹음이 통째로 사라진다.
    const onSalvaged = vi.fn();
    const { result } = renderHook(() => useMeetingRecorder({ onSalvaged }));
    await act(async () => {
      await result.current.start();
    });

    const recorder = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
    act(() => {
      // 오류 직전까지 녹음된 청크가 있는 상황
      recorder.ondataavailable?.({ data: new Blob(["chunk"], { type: recorder.mimeType }) });
      recorder.onerror?.();
    });

    expect(result.current.status).toBe("error");
    expect(onSalvaged).toHaveBeenCalledTimes(1);
    expect(onSalvaged.mock.calls[0][0].blob.size).toBeGreaterThan(0);
  });

  it("마이크 권한 대기 중 언마운트되면 뒤늦게 받은 스트림을 즉시 반납한다", async () => {
    const mockTrack = { stop: vi.fn() };
    let resolveStream: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn().mockReturnValue(
      new Promise<MediaStream>(resolve => {
        resolveStream = resolve;
      }),
    );
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });

    const { result, unmount } = renderHook(() => useMeetingRecorder());
    let startPromise!: Promise<void>;
    act(() => {
      startPromise = result.current.start();
    });

    unmount();

    await act(async () => {
      resolveStream({ getTracks: () => [mockTrack] } as unknown as MediaStream);
      await startPromise;
    });

    // 언마운트 뒤 도착한 스트림이 방치되면 마이크가 계속 켜진 채로 남는다
    expect(mockTrack.stop).toHaveBeenCalled();
    // 정리 주체가 사라진 뒤에는 MediaRecorder를 만들지도, 녹음을 시작하지도 않아야 한다
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("녹음 중 MediaRecorder 오류가 나면 마이크 트랙을 정리하고 다시 녹음할 수 있다", async () => {
    const mockTrack = { stop: vi.fn() };
    const getUserMedia = vi
      .fn()
      .mockResolvedValue({ getTracks: () => [mockTrack] } as unknown as MediaStream);
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useMeetingRecorder());
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1].onerror?.();
    });

    expect(result.current.status).toBe("error");
    // 마이크가 꺼져야 브라우저 녹음 표시가 사라진다
    expect(mockTrack.stop).toHaveBeenCalled();

    // 오류 이후에도 잠기지 않고 새 스트림으로 다시 시작할 수 있어야 한다
    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("recording");
  });
});
