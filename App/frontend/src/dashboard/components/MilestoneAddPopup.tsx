import { useState } from "react";
import { X } from "lucide-react";
import { createMilestone, updateMilestone } from "../libs/utils/milestoneApi";
import type { MilestoneProgressDto } from "../libs/types/dashboard";

interface MilestoneAddPopupProps {
  projectId: number;
  /** 수정 모드로 열 때 넘긴다 — 있으면 기존 값으로 채워지고 저장 시 수정 API를 호출한다. */
  editTarget?: MilestoneProgressDto | null;
  onClose: () => void;
  onCreated: () => void;
}

export function MilestoneAddPopup({ projectId, editTarget, onClose, onCreated }: MilestoneAddPopupProps) {
  const isEdit = editTarget != null;
  const [title, setTitle] = useState(editTarget?.title ?? "");
  const [startDate, setStartDate] = useState(editTarget?.startDate ?? "");
  const [dueDate, setDueDate] = useState(editTarget?.dueDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("마일스톤 이름을 입력해주세요.");
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError("시작일은 마감일보다 늦을 수 없습니다.");
      return;
    }
    if (!window.confirm(isEdit ? "변경사항을 반영할까요?" : "마일스톤을 추가할까요?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = { title: title.trim(), startDate: startDate || null, dueDate: dueDate || null };
      if (isEdit) {
        await updateMilestone(projectId, editTarget.id, input);
      } else {
        await createMilestone(projectId, input);
      }
      onCreated();
    } catch {
      setError(isEdit ? "마일스톤 수정에 실패했습니다. 잠시 후 다시 시도해주세요." : "마일스톤 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
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
            <h2 className="text-base font-bold text-foreground">{isEdit ? "마일스톤 수정" : "마일스톤 추가"}</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <div className="p-6 space-y-3">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">마일스톤 이름 <span className="text-red-500">*</span></label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="예) 착수보고 발표"
                className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">시작일</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">마감일</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
            </div>
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
                {submitting ? (isEdit ? "수정 중..." : "추가 중...") : (isEdit ? "수정" : "추가")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
