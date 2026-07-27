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
  const isStartingRef = useRef<boolean>(false);

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

  const start = useCallback(async () => {
    // Synchronous guard using ref to prevent same-tick race
    if (isStartingRef.current) return;
    isStartingRef.current = true;

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
      mediaRecorderRef.current = recorder;
      recorder.start();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, TIMER_INTERVAL_MS);
      setStatus("recording");
    } catch {
      isStartingRef.current = false;
      setStatus("error");
      setError("마이크 권한을 확인할 수 없습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.");
    }
  }, []);

  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;
    if (!recorder || recorder.state === "inactive") return null;

    const mimeType = recorder.mimeType || "audio/webm";
    const result = await new Promise<RecordedAudio>(resolve => {
      recorder.onstop = () => {
        resolve({ blob: new Blob(chunksRef.current, { type: mimeType }), mimeType });
      };
      recorder.stop();
    });

    stopTimer();
    stream?.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    isStartingRef.current = false;
    setStatus("stopped");
    return result;
  }, [stopTimer]);

  return { status, elapsedSeconds, error, start, stop };
}
