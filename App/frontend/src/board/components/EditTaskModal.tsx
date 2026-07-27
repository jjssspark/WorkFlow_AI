import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CATEGORIES } from "../libs/mock/tasks";
import { getCat } from "../libs/utils/taskService";
import { CAT_MODAL_FIELDS } from "../libs/utils/catFields";
import { updateTask, DEMO_PROJECT_ID } from "../libs/utils/taskApi";
import { useAuth } from "../../global/hooks/useAuth";
import { useProject } from "../../global/hooks/useProject";
import type { MemberResponse } from "../../global/api/projectsApi";
import type { Priority, Task } from "../libs/types/task";

interface EditTaskModalProps {
  task: Task | null;
  projectMembers: MemberResponse[];
  onClose: () => void;
  onUpdated: (task: Task) => void;
}

export function EditTaskModal({ task, projectMembers, onClose, onUpdated }: EditTaskModalProps) {
  const { currentProjectId } = useAuth();
  const project = useProject(currentProjectId);
  const [selCat, setSelCat] = useState("");
  const [customCat, setCustomCat] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    const knownCat = CATEGORIES.some((c) => c.id === task.category);
    setSelCat(knownCat ? task.category : "other");
    setCustomCat(knownCat ? "" : task.category);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setAssigneeId(task.assignee ?? "");
    setStartDate(task.startDate ?? "");
    setDueDate(task.dueDate);
    setPriority(task.priority);
    setExtraFields(task.extraFields ?? {});
    setError(null);
  }, [task, projectMembers]);

  if (!task) return null;

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("업무 제목은 비워둘 수 없습니다.");
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError("시작일은 마감일보다 늦을 수 없습니다.");
      return;
    }
    const category = selCat === "other" ? (customCat.trim() || "other") : selCat;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateTask(task.id, {
        title: title.trim(),
        category,
        assigneeId,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
        priority,
        description: description.trim() || undefined,
        extraFields,
      }, currentProjectId ?? DEMO_PROJECT_ID);
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "수정에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-bold text-foreground">업무 수정</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">업무명 <span className="text-red-500">*</span></label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">업무 설명</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="업무의 목적과 범위를 간략히 설명하세요"
                className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">카테고리</label>
              <select
                value={selCat}
                onChange={(e) => setSelCat(e.target.value)}
                className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400"
              >
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {selCat === "other" && (
                <input
                  value={customCat}
                  onChange={(e) => setCustomCat(e.target.value)}
                  placeholder="카테고리명을 직접 입력하세요 (예: 하드웨어, 영상 편집)"
                  className="mt-2 w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">담당자</label>
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400">
                  <option value="">⚠ 미배정</option>
                  {projectMembers.map((m) => <option key={m.userId} value={String(m.userId)}>{m.name} ({m.role})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">시작일</label>
                <input type="date" min={project?.startDate ?? undefined} max={dueDate || project?.deadline || undefined} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">마감일</label>
                <input type="date" min={startDate || project?.startDate || undefined} max={project?.deadline ?? undefined} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">우선순위</label>
              <div className="flex gap-1.5">
                {(["low", "medium", "high"] as Priority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${priority === p ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-card text-muted-foreground hover:border-slate-300"}`}
                  >
                    {p === "low" ? "낮음" : p === "medium" ? "중간" : "높음"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">카테고리 전용 정보</label>
              <div className="space-y-2.5">
                {(CAT_MODAL_FIELDS[selCat === "other" ? "other" : selCat] ?? CAT_MODAL_FIELDS.other).map(([label, placeholder]) => (
                  <div key={label}>
                    <label className="text-[10.5px] text-muted-foreground block mb-1">{label}</label>
                    <input
                      value={extraFields[label] ?? ""}
                      onChange={(e) => setExtraFields((cur) => ({ ...cur, [label]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">카테고리 미리보기: {getCat(selCat === "other" ? (customCat.trim() || "other") : selCat).label}</p>
          </div>

          <div className="flex flex-col gap-2 px-6 py-4 border-t border-border">
            {error && <div className="text-xs text-red-600">{error}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
              >
                {submitting ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
