import { useEffect } from "react";
import { toast } from "sonner";
import { useRecordingSession } from "../../../meetings/libs/hooks/RecordingSessionProvider";

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function RecordingIndicator() {
  const { status, elapsedSeconds, error, requestStop } = useRecordingSession();

  // 녹음 실패(마이크 권한 거부, MediaRecorder 오류)는 이 컴포넌트가 유일한 노출 지점이다.
  useEffect(() => {
    if (status === "error" && error) toast.error(error);
  }, [status, error]);

  if (status !== "recording") return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white shadow-lg border border-red-200">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
      <span className="text-xs font-mono font-semibold text-foreground">{formatElapsed(elapsedSeconds)}</span>
      <button type="button" onClick={requestStop} className="text-xs font-medium text-red-600 hover:text-red-700">
        녹화 종료
      </button>
    </div>
  );
}
