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
    // 녹음 원본은 의도적으로 메모리에만 둔다(디스크에 저장하지 않음).
    // IndexedDB 등에 임시 저장하면 새로고침 복구는 되지만 회의 음성이 사용자 기기에
    // 남아 삭제 정책·공용 PC 잔존 등 개인정보 위험이 더 커진다. 그 대가로 새로고침·탭
    // 종료 시 복구가 불가능하므로, 아래 경고가 유일한 방어선이다 — 지우지 말 것.
    // 복구가 필요해지면 저장 위치·보관 기간·삭제 시점을 함께 설계해 별도로 도입한다.
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
