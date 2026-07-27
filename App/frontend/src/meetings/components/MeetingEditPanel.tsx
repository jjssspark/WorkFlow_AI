import { useState } from "react";
import { createMeetingVersion, fetchMeeting } from "../libs/utils/meetingAiApi";

type MeetingEditPanelProps = {
  projectId: string;
  meetingId: string;
  initialTranscript: string;
  onSaved: () => void;
  onAnalyzed: () => void;
};

const ANALYSIS_POLL_INTERVAL_MS = 2000;
const ANALYSIS_MAX_POLL_ATTEMPTS = 60;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "저장에 실패했습니다. 잠시 후 다시 시도해주세요.";
}

// createMeetingVersion(triggerAnalysis: true)는 분석을 비동기로 큐에 넣고 즉시
// PROCESSING 상태로 응답한다. 완료를 기다리지 않고 바로 onAnalyzed()를 호출하면
// 실제로는 백그라운드에서 분석이 진행 중인데도 사용자에게는 "재분석이 안 되는 것"처럼 보인다.
async function waitForAnalysisCompletion(projectId: string, versionMeetingId: string): Promise<void> {
  for (let attempt = 0; attempt < ANALYSIS_MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, ANALYSIS_POLL_INTERVAL_MS));
    const response = await fetchMeeting(projectId, versionMeetingId);
    if (response.status === "COMPLETED") return;
    if (response.status === "FAILED") {
      throw new Error(response.errorMessage ?? "재분석에 실패했습니다.");
    }
  }
  throw new Error("분석 시간이 초과되었습니다. 잠시 후 다시 확인해주세요.");
}

export function MeetingEditPanel({ projectId, meetingId, initialTranscript, onSaved, onAnalyzed }: MeetingEditPanelProps) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [submittingAction, setSubmittingAction] = useState<"save" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = submittingAction !== null;

  const handleSave = async () => {
    setSubmittingAction("save");
    setError(null);
    try {
      await createMeetingVersion(projectId, meetingId, transcript, false);
      onSaved();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleAnalyze = async () => {
    setSubmittingAction("analyze");
    setError(null);
    try {
      const version = await createMeetingVersion(projectId, meetingId, transcript, true);
      if (version.status === "PROCESSING") {
        await waitForAnalysisCompletion(projectId, version.meetingId);
      }
      onAnalyzed();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        className="w-full min-h-[240px] rounded-lg border border-border bg-card p-3 text-sm text-foreground"
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleSave}
          className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleAnalyze}
          className="px-4 py-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submittingAction === "analyze" ? "분석 중..." : "분석하기"}
        </button>
      </div>
    </div>
  );
}
