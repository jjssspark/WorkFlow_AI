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
  const [pendingBlob, setPendingBlob] = useState<RecordedAudio | null>(null);
  // 녹음 중 오류로 중단된 경우엔 대기 중인 stop()이 없어 결과를 받을 곳이 없다.
  // 살려낸 원본을 저장 모달까지 전달해 사용자가 잃지 않게 한다.
  const recorder = useMeetingRecorder({ onSalvaged: setPendingBlob });
  // recorder 객체 자체는 elapsedSeconds tick마다 새로 만들어지므로,
  // 콜백/컨텍스트 값의 의존성은 실제로 쓰는 개별 필드로 좁힌다.
  const { status, elapsedSeconds, error, start, stop } = recorder;

  const startRecording = useCallback(async () => {
    if (status === "recording") return;
    await start();
  }, [status, start]);

  const requestStop = useCallback(() => {
    if (status !== "recording") return;
    stop()
      .then(result => {
        if (result) setPendingBlob(result);
      })
      // stop()은 내부에서 오류를 status/error로 바꿔 알리므로 여기선 미처리 rejection만 막는다.
      .catch(() => {});
  }, [status, stop]);

  const clearPendingBlob = useCallback(() => setPendingBlob(null), []);

  useEffect(() => {
    // 녹음 중뿐 아니라 "종료했지만 아직 저장하지 않은" 구간(저장 모달이 열려 pendingBlob을
    // 들고 있는 동안)도 보호해야 한다. 사용자가 제목·참석자를 입력하는 바로 그때 새로고침하면
    // 경고 없이 메모리의 원본이 사라진다.
    const hasUnsavedRecording = status === "recording" || pendingBlob !== null;
    if (!hasUnsavedRecording) return;
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
  }, [status, pendingBlob]);

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
