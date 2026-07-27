import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMeetingRecorder, type RecorderStatus, type RecordedAudio } from "./useMeetingRecorder";

interface RecordingSessionState {
  status: RecorderStatus;
  elapsedSeconds: number;
  error: string | null;
  startRecording: () => Promise<void>;
  requestStop: () => void;
  pendingBlob: RecordedAudio | null;
  clearPendingBlob: () => void;
}

const RecordingSessionContext = createContext<RecordingSessionState | null>(null);

export function RecordingSessionProvider({ children }: { children: ReactNode }) {
  const recorder = useMeetingRecorder();
  const [pendingBlob, setPendingBlob] = useState<RecordedAudio | null>(null);
  // recorder 객체 자체는 elapsedSeconds tick마다 새로 만들어지므로,
  // 콜백/컨텍스트 값의 의존성은 실제로 쓰는 개별 필드로 좁힌다.
  const { status, elapsedSeconds, error, start, stop } = recorder;

  const startRecording = useCallback(async () => {
    if (status === "recording") return;
    await start();
  }, [status, start]);

  const requestStop = useCallback(() => {
    if (status !== "recording") return;
    stop().then(result => {
      if (result) setPendingBlob(result);
    });
  }, [status, stop]);

  const clearPendingBlob = useCallback(() => setPendingBlob(null), []);

  useEffect(() => {
    if (status !== "recording") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);

  const value = useMemo<RecordingSessionState>(
    () => ({ status, elapsedSeconds, error, startRecording, requestStop, pendingBlob, clearPendingBlob }),
    [status, elapsedSeconds, error, startRecording, requestStop, pendingBlob, clearPendingBlob],
  );

  return <RecordingSessionContext.Provider value={value}>{children}</RecordingSessionContext.Provider>;
}

export function useRecordingSession(): RecordingSessionState {
  const ctx = useContext(RecordingSessionContext);
  if (!ctx) throw new Error("useRecordingSession must be used within RecordingSessionProvider");
  return ctx;
}
