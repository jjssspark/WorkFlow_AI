import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMeetingRecorder, type RecorderStatus, type RecordedAudio } from "./useMeetingRecorder";

interface RecordingSessionState {
  status: RecorderStatus;
  error: string | null;
  startRecording: () => Promise<void>;
  requestStop: () => void;
  pendingBlob: RecordedAudio | null;
  clearPendingBlob: () => void;
}

const RecordingSessionContext = createContext<RecordingSessionState | null>(null);
// elapsedSeconds는 녹음 중 매초 바뀌므로 세션 컨텍스트에서 분리한다. 한 컨텍스트로 묶으면
// 값 객체 identity가 매초 바뀌어, 시간을 쓰지 않는 소비자(MeetingsView 등)까지 함께 리렌더된다.
const RecordingElapsedContext = createContext<number>(0);

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
    () => ({ status, error, startRecording, requestStop, pendingBlob, clearPendingBlob }),
    [status, error, startRecording, requestStop, pendingBlob, clearPendingBlob],
  );

  return (
    <RecordingSessionContext.Provider value={value}>
      <RecordingElapsedContext.Provider value={elapsedSeconds}>
        {children}
      </RecordingElapsedContext.Provider>
    </RecordingSessionContext.Provider>
  );
}

export function useRecordingSession(): RecordingSessionState {
  const ctx = useContext(RecordingSessionContext);
  if (!ctx) throw new Error("useRecordingSession must be used within RecordingSessionProvider");
  return ctx;
}

// 경과 시간만 필요한 컴포넌트(RecordingIndicator)용. 이 훅을 쓰는 컴포넌트만 매초 리렌더된다.
export function useRecordingElapsedSeconds(): number {
  return useContext(RecordingElapsedContext);
}
