import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting-permission" | "recording" | "stopped" | "error";

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
}

export interface UseMeetingRecorder {
  status: RecorderStatus;
  elapsedSeconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<RecordedAudio | null>;
}

export interface UseMeetingRecorderOptions {
  // 오류로 녹음이 중단됐을 때 그때까지 모인 원본을 넘겨받는다. 녹음 중 오류는 대개
  // 대기 중인 stop()이 없으므로, 이 콜백이 원본을 잃지 않는 유일한 전달 경로다.
  onSalvaged?: (audio: RecordedAudio) => void;
}

const TIMER_INTERVAL_MS = 1000;
// MediaRecorder.start()를 timeslice 없이 호출하면 dataavailable이 stop() 시점에 단 한 번만
// 발생한다. 그러면 정상 종료 전에 오류가 났을 때 살릴 청크가 하나도 없어 긴 녹음이 통째로
// 사라진다. 주기적으로 청크를 받아 두면 중단되더라도 직전까지는 복구할 수 있다.
// 값이 클수록 잃는 구간이 길어지고, 작을수록 청크 수가 늘어난다.
const CHUNK_INTERVAL_MS = 5000;

export function useMeetingRecorder(options: UseMeetingRecorderOptions = {}): UseMeetingRecorder {
  const onSalvagedRef = useRef(options.onSalvaged);
  useEffect(() => {
    onSalvagedRef.current = options.onSalvaged;
  });
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // 세션이 점유 중인지를 나타낸다 — start() 중복 호출을 막고, stop()/에러에서 해제된다.
  const isBusyRef = useRef<boolean>(false);
  // stop()이 진행 중인지. 종료 버튼 연속 클릭으로 stop()이 겹치면 뒤 호출이
  // 앞 호출의 Blob 생성 전에 chunksRef를 비워 빈 녹음이 저장되므로 이를 막는다.
  const isStoppingRef = useRef<boolean>(false);
  // stop()이 대기 중인 Promise의 resolve. 오류 경로에서도 반드시 매듭지어야 한다.
  const pendingStopResolveRef = useRef<((value: RecordedAudio | null) => void) | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  // 권한 요청 등 비동기 대기 중에 언마운트됐는지. 뒤늦게 받은 스트림을 반납하는 데 쓴다.
  const isUnmountedRef = useRef<boolean>(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStreamTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      stopTimer();
      stopStreamTracks();
    };
  }, [stopTimer, stopStreamTracks]);

  const buildRecordedAudio = useCallback((): RecordedAudio | null => {
    if (chunksRef.current.length === 0) return null;
    return { blob: new Blob(chunksRef.current, { type: mimeTypeRef.current }), mimeType: mimeTypeRef.current };
  }, []);

  // 대기 중인 stop()을 반드시 매듭짓는다. 빠뜨리면 종료 요청이 영구 대기하고,
  // isStoppingRef가 잠긴 채 남아 이후 녹음마저 종료할 수 없게 된다.
  const settlePendingStop = useCallback((value: RecordedAudio | null) => {
    const resolvePendingStop = pendingStopResolveRef.current;
    pendingStopResolveRef.current = null;
    isStoppingRef.current = false;
    resolvePendingStop?.(value);
  }, []);

  // 실패 시에도 마이크를 반드시 끈다. 트랙을 살려두면 브라우저 녹음 표시가 남고,
  // 곧바로 다시 start()하면 streamRef가 덮어써져 이전 스트림이 영영 정리되지 않는다.
  const failWithError = useCallback((message: string) => {
    stopTimer();
    stopStreamTracks();
    // 오류 시점까지 모인 청크는 살려서 돌려준다 — 녹음이 통째로 사라지지 않게.
    const salvaged = buildRecordedAudio();
    const hadPendingStop = pendingStopResolveRef.current !== null;
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    isBusyRef.current = false;
    settlePendingStop(salvaged);
    // 대기 중인 stop()이 없으면(녹음 중 오류가 난 대부분의 경우) 위 resolve가 아무에게도
    // 닿지 않는다. 콜백으로 넘겨야 원본이 저장 모달까지 도달한다.
    if (!hadPendingStop && salvaged) onSalvagedRef.current?.(salvaged);
    setStatus("error");
    setError(message);
  }, [stopTimer, stopStreamTracks, buildRecordedAudio, settlePendingStop]);

  const start = useCallback(async () => {
    // Synchronous guard using ref to prevent same-tick race
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    setStatus("requesting-permission");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 권한 대기 중 언마운트됐다면 뒤늦게 받은 스트림을 즉시 반납한다. 그러지 않으면
      // 정리 주체가 사라진 채 마이크가 계속 켜지고 타이머도 남는다.
      if (isUnmountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        isBusyRef.current = false;
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || "audio/webm";
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      // 녹음 도중 기저 MediaRecorder가 실패하는 경우(장치 분리 등)도 시작 실패와 동일하게 처리한다.
      recorder.onerror = () => {
        failWithError("녹음 중 오류가 발생했습니다. 다시 시도해주세요.");
      };
      mediaRecorderRef.current = recorder;
      recorder.start(CHUNK_INTERVAL_MS);
      // 백그라운드 탭 throttle로 tick이 밀려도 표시 시간이 어긋나지 않도록
      // 카운터 증가 대신 시작 시각과의 차이로 계산한다.
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        if (startedAtRef.current === null) return;
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, TIMER_INTERVAL_MS);
      setStatus("recording");
    } catch {
      failWithError("마이크 권한을 확인할 수 없습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.");
    }
  }, [failWithError]);

  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    // 이미 종료 처리가 진행 중이면 어떤 공유 상태도 건드리지 않고 즉시 반환한다.
    // MediaRecorder.stop()은 state를 동기적으로 inactive로 바꾸므로, 이 가드가 없으면
    // 두 번째 호출이 아래 조기반환 분기로 들어가 chunksRef를 비워버린다.
    if (isStoppingRef.current) return null;

    const recorder = mediaRecorderRef.current;
    // 멈출 대상이 없으면(기저 recorder가 스스로 inactive가 된 경우 포함) 훅이 잠기지 않도록
    // busy 가드와 status를 idle로 되돌린 뒤 반환한다.
    if (!recorder || recorder.state === "inactive") {
      stopTimer();
      stopStreamTracks();
      // 기저 recorder가 스스로 멈춘 경우에도 모인 청크가 있으면 버리지 않고 돌려준다.
      const salvaged = buildRecordedAudio();
      mediaRecorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      isBusyRef.current = false;
      setStatus(salvaged ? "stopped" : "idle");
      return salvaged;
    }

    isStoppingRef.current = true;
    try {
      const result = await new Promise<RecordedAudio | null>(resolve => {
        pendingStopResolveRef.current = resolve;
        recorder.onstop = () => settlePendingStop(buildRecordedAudio());
        recorder.stop();
      });

      // 오류 경로(failWithError)가 먼저 매듭지었다면 정리와 상태 설정이 이미 끝났다.
      // 여기서 status를 "stopped"로 덮어쓰면 사용자에게 오류가 가려진다.
      if (mediaRecorderRef.current === null) return result;

      stopTimer();
      stopStreamTracks();
      mediaRecorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      isBusyRef.current = false;
      setStatus("stopped");
      return result;
    } catch {
      // recorder.stop()이 동기적으로 던지면(InvalidStateError 등) 마이크와 busy 가드가
      // 남아 세션이 잠기고 다시 녹음할 수 없게 된다. 오류 경로와 동일하게 전부 정리한다.
      // 대기 중이던 stop()은 이미 무효이므로 참조를 먼저 비워, 살려낸 원본이 콜백으로 가게 한다.
      pendingStopResolveRef.current = null;
      failWithError("녹음을 종료하지 못했습니다. 다시 시도해주세요.");
      return null;
    } finally {
      // 정상 경로는 settlePendingStop이 이미 해제했지만 안전망으로 한 번 더 해제한다.
      pendingStopResolveRef.current = null;
      isStoppingRef.current = false;
    }
  }, [stopTimer, stopStreamTracks, buildRecordedAudio, settlePendingStop, failWithError]);

  return { status, elapsedSeconds, error, start, stop };
}
