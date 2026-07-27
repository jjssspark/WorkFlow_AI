import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

  const startRecording = useCallback(async () => {
    if (recorder.status === "recording") return;
    await recorder.start();
  }, [recorder]);

  const requestStop = useCallback(() => {
    if (recorder.status !== "recording") return;
    recorder.stop().then(result => {
      if (result) setPendingBlob(result);
    });
  }, [recorder]);

  const clearPendingBlob = useCallback(() => setPendingBlob(null), []);

  useEffect(() => {
    if (recorder.status !== "recording") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [recorder.status]);

  const value: RecordingSessionState = {
    status: recorder.status,
    elapsedSeconds: recorder.elapsedSeconds,
    error: recorder.error,
    startRecording,
    requestStop,
    pendingBlob,
    clearPendingBlob,
  };

  return <RecordingSessionContext.Provider value={value}>{children}</RecordingSessionContext.Provider>;
}

export function useRecordingSession(): RecordingSessionState {
  const ctx = useContext(RecordingSessionContext);
  if (!ctx) throw new Error("useRecordingSession must be used within RecordingSessionProvider");
  return ctx;
}
