import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getProjectMembers, type MemberResponse } from "../../global/api/projectsApi";
import { updateTask } from "../../board/libs/utils/taskApi";
import type { DashboardTaskDto } from "../libs/types/dashboard";

interface TaskAssigneePopupProps {
  task: DashboardTaskDto;
  projectId: number;
  onClose: () => void;
  onChanged: () => void;
}

export function TaskAssigneePopup({ task, projectId, onClose, onChanged }: TaskAssigneePopupProps) {
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProjectMembers(projectId)
      .then(result => { if (!cancelled) setMembers(result); })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleSubmit = async () => {
    if (!assigneeId) {
      setError("담당자를 선택해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateTask(task.id, { assigneeId }, projectId);
      alert("변경이 완료되었습니다.");
      onChanged();
    } catch {
      setError("담당자 변경에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-base font-bold text-foreground">담당자 변경</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <div className="p-6 space-y-3">
            <div className="text-xs text-muted-foreground truncate">{task.title}</div>
            {membersLoading ? (
              <div className="text-xs text-muted-foreground">담당자 목록을 불러오는 중입니다</div>
            ) : (
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400"
              >
                <option value="">선택 안 함</option>
                {members.map(m => <option key={m.userId} value={String(m.userId)}>{m.name} ({m.role})</option>)}
              </select>
            )}
          </div>
          <div className="flex flex-col gap-2 px-6 py-4 border-t border-border">
            {error && <div className="text-xs text-red-600">{error}</div>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors">취소</button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, var(--primary), var(--sidebar-primary))" }}
              >
                {submitting ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
