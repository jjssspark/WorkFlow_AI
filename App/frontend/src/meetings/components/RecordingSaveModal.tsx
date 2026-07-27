import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "../../global/hooks/useAuth";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import { analyzeMeeting } from "../libs/utils/meetingAiApi";
import { useRecordingSession } from "../libs/hooks/RecordingSessionProvider";

const MEET_KINDS = ["정기회의", "중간점검", "발표준비", "개발회의", "기타"];

const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
};

const resolveExtension = (mimeType: string): string => MIME_TO_EXTENSION[mimeType] ?? ".webm";

const getTodayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const buildRecordingFileName = (mimeType: string): string => {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `녹음_${getTodayIsoDate().replace(/-/g, "")}_${hhmm}${resolveExtension(mimeType)}`;
};

export function RecordingSaveModal() {
  const { pendingBlob, clearPendingBlob } = useRecordingSession();
  const { currentProjectId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(getTodayIsoDate());
  const [meetingKind, setMeetingKind] = useState(MEET_KINDS[0]);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingBlob || currentProjectId == null) return;
    getProjectMembers(currentProjectId).then(setMembers).catch(() => setMembers([]));
    setTitle(`녹음 회의록 ${getTodayIsoDate()}`);
    setMeetingDate(getTodayIsoDate());
    setMeetingKind(MEET_KINDS[0]);
    setParticipantIds([]);
    setErrorMessage(null);
  }, [pendingBlob, currentProjectId]);

  if (!pendingBlob || currentProjectId == null) return null;

  const toggleParticipant = (id: string) => {
    setParticipantIds(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const handleConfirm = async () => {
    if (!title.trim() || participantIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const file = new File([pendingBlob.blob], buildRecordingFileName(pendingBlob.mimeType), {
        type: pendingBlob.mimeType,
      });
      const attendeeIds = participantIds.map(id => Number(id)).filter(id => !Number.isNaN(id));
      const participantNames = members
        .filter(member => participantIds.includes(String(member.userId)))
        .map(member => member.name ?? "");
      await analyzeMeeting({
        projectId: String(currentProjectId),
        file,
        title: title.trim(),
        meetingDate,
        meetingKind,
        sourceType: "audio",
        participants: participantNames,
        attendeeIds,
      });
      clearPendingBlob();
      toast.success("녹음 회의록 분석이 시작되었습니다. 완료되면 알려드립니다.");
      if (!location.pathname.startsWith("/meetings")) navigate("/meetings");
    } catch {
      setErrorMessage("분석 요청에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h2 className="text-base font-bold text-foreground">녹음 회의록 저장</h2>
          {errorMessage && <div className="text-xs text-red-600">{errorMessage}</div>}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="recording-title">제목</label>
            <input id="recording-title" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="recording-date">날짜</label>
            <input id="recording-date" type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="recording-kind">유형</label>
            <select id="recording-kind" value={meetingKind} onChange={e => setMeetingKind(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg">
              {MEET_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">참석자</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map(member => (
                <button type="button" key={member.userId} onClick={() => toggleParticipant(String(member.userId))}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    participantIds.includes(String(member.userId))
                      ? "bg-blue-100 border-blue-300 text-blue-700"
                      : "bg-card border-border text-muted-foreground"
                  }`}>
                  {member.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={clearPendingBlob} disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted rounded-lg disabled:opacity-50">
              취소
            </button>
            <button type="button" onClick={handleConfirm}
              disabled={isSubmitting || !title.trim() || participantIds.length === 0}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
              {isSubmitting ? "분석 요청 중..." : "저장 및 분석 시작"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
