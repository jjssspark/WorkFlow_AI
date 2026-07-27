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

const TIMER_INTERVAL_MS = 1000;

export function useMeetingRecorder(): UseMeetingRecorder {
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
    return () => {
      stopTimer();
      stopStreamTracks();
    };
  }, [stopTimer, stopStreamTracks]);

  // 실패 시에도 마이크를 반드시 끈다. 트랙을 살려두면 브라우저 녹음 표시가 남고,
  // 곧바로 다시 start()하면 streamRef가 덮어써져 이전 스트림이 영영 정리되지 않는다.
  const failWithError = useCallback((message: string) => {
    stopTimer();
    stopStreamTracks();
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    isBusyRef.current = false;
    setStatus("error");
    setError(message);
  }, [stopTimer, stopStreamTracks]);

  const start = useCallback(async () => {
    // Synchronous guard using ref to prevent same-tick race
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    setStatus("requesting-permission");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      // 녹음 도중 기저 MediaRecorder가 실패하는 경우(장치 분리 등)도 시작 실패와 동일하게 처리한다.
      recorder.onerror = () => {
        failWithError("녹음 중 오류가 발생했습니다. 다시 시도해주세요.");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
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
      mediaRecorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      isBusyRef.current = false;
      setStatus("idle");
      return null;
    }

    isStoppingRef.current = true;
    const mimeType = recorder.mimeType || "audio/webm";
    try {
      const result = await new Promise<RecordedAudio>(resolve => {
        recorder.onstop = () => {
          resolve({ blob: new Blob(chunksRef.current, { type: mimeType }), mimeType });
        };
        recorder.stop();
      });

      stopTimer();
      stopStreamTracks();
      mediaRecorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      isBusyRef.current = false;
      setStatus("stopped");
      return result;
    } finally {
      isStoppingRef.current = false;
    }
  }, [stopTimer, stopStreamTracks]);

  return { status, elapsedSeconds, error, start, stop };
}
