import { useEffect, useState } from "react";
import { X, Check, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { CatTag } from "./CatTag";
import { CATEGORIES } from "../libs/mock/tasks";
import { getCat } from "../libs/utils/taskService";
import { CAT_MODAL_FIELDS } from "../libs/utils/catFields";
import { createTask, DEMO_PROJECT_ID } from "../libs/utils/taskApi";
import { useAuth } from "../../global/hooks/useAuth";
import { useProject } from "../../global/hooks/useProject";
import type { MemberResponse } from "../../global/api/projectsApi";
import type { Priority, Task, TaskStatus } from "../libs/types/task";

const STEPS = ["카테고리 선택", "기본 정보", "추가 정보", "생성 완료"];

interface AddTaskModalProps {
  open: boolean;
  initialStatus: TaskStatus;
  projectMembers: MemberResponse[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}

export function AddTaskModal({ open, initialStatus, projectMembers, onClose, onCreated }: AddTaskModalProps) {
  const { currentProjectId } = useAuth();
  const project = useProject(currentProjectId);
  const [step, setStep] = useState(0);
  const [selCat, setSelCat] = useState("");
  const [customCat, setCustomCat] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fStart, setFStart] = useState("");
  const [fDue, setFDue] = useState("");
  const [fPriority, setFPriority] = useState<Priority>("medium");
  const [fStatus, setFStatus] = useState<TaskStatus>("todo");
  const [fCriteria, setFCriteria] = useState("");
  const [fExtraFields, setFExtraFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFStatus(initialStatus);
      setSelCat("");
      setStep(0);
      setFTitle("");
      setFDesc("");
      setFAssignee(String(projectMembers[0]?.userId ?? ""));
      setFStart("");
      setFDue("");
      setFPriority("medium");
      setFCriteria("");
      setFExtraFields({});
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStatus, projectMembers]);

  if (!open) return null;

  const handleNext = async () => {
    if (step === 2) {
      if (fStart && fDue && fStart > fDue) {
        setSubmitError("시작일은 마감일보다 늦을 수 없습니다.");
        return;
      }
      const cat = selCat === "other" ? (customCat.trim() || "other") : selCat;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const created = await createTask({
          title: fTitle.trim() || `${getCat(selCat).label} 업무`,
          category: cat,
          status: fStatus,
          assigneeId: fAssignee,
          startDate: fStart || null,
          dueDate: fDue || null,
          priority: fPriority,
          description: fDesc.trim() || undefined,
          extraFields: fExtraFields,
        }, currentProjectId ?? DEMO_PROJECT_ID);
        onCreated(created);
        setStep(step + 1);
      } catch (cause) {
        setSubmitError(cause instanceof Error ? cause.message : "업무 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
          {/* Stepper header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3 overflow-x-auto">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2 shrink-0">
                  {i > 0 && <div className={`w-8 h-0.5 rounded ${i <= step ? "bg-blue-400" : "bg-border"}`} />}
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < step ? "bg-emerald-500 text-white" : i === step ? "text-white" : "bg-muted text-muted-foreground"}`}
                    style={i === step ? { background: "var(--primary)" } : {}}
                  >
                    {i < step ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs font-semibold whitespace-nowrap ${i === step ? "text-foreground" : i < step ? "text-emerald-600" : "text-muted-foreground"}`}>{s}</span>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors ml-4 shrink-0"><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>

          {/* Modal body */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
            {/* Step 0: Category */}
            {step === 0 && (
              <div>
                <h2 className="text-lg font-bold text-foreground mb-0.5">카테고리를 선택하세요</h2>
                <p className="text-sm text-muted-foreground mb-4">업무 유형에 맞는 카테고리를 선택하면 관련 입력 항목이 자동으로 구성됩니다.</p>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    const sel = selCat === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelCat(cat.id)}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border-2 text-left transition-all hover:shadow-sm ${sel ? "shadow-sm" : "border-border hover:border-slate-300"}`}
                        style={sel ? { borderColor: cat.color, background: cat.bg } : {}}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: sel ? cat.bg : "#F4F6FA" }}>
                          <Icon className="w-4 h-4" style={{ color: cat.color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground leading-tight">{cat.label}</div>
                          <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">{cat.desc}</div>
                        </div>
                        {sel && <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: cat.color }}><Check className="w-2.5 h-2.5 text-white" /></div>}
                      </button>
                    );
                  })}
                </div>
                {selCat === "other" && (
                  <div className="mt-3">
                    <input
                      value={customCat}
                      onChange={(e) => setCustomCat(e.target.value)}
                      placeholder="카테고리명을 직접 입력하세요 (예: 하드웨어, 영상 편집)"
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Common fields */}
            {step === 1 && (
              <div>
                <div className="flex items-center gap-2 mb-4"><CatTag catId={selCat} /><h2 className="text-lg font-bold text-foreground">기본 업무 정보</h2></div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">업무명 <span className="text-red-500">*</span></label>
                    <input
                      value={fTitle}
                      onChange={(e) => setFTitle(e.target.value)}
                      placeholder={`${getCat(selCat).label} 관련 업무명`}
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">업무 설명</label>
                    <textarea
                      value={fDesc}
                      onChange={(e) => setFDesc(e.target.value)}
                      rows={3}
                      placeholder="업무의 목적과 범위를 간략히 설명하세요"
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">담당자</label>
                      <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400">
                        {projectMembers.map((m) => <option key={m.userId} value={String(m.userId)}>{m.name} ({m.role})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">시작일</label>
                      <input type="date" min={project?.startDate ?? undefined} max={fDue || project?.deadline || undefined} value={fStart} onChange={(e) => setFStart(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">마감일</label>
                      <input type="date" min={fStart || project?.startDate || undefined} max={project?.deadline ?? undefined} value={fDue} onChange={(e) => setFDue(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">우선순위</label>
                      <div className="flex gap-1.5">
                        {(["low", "medium", "high"] as Priority[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => setFPriority(p)}
                            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${fPriority === p ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-card text-muted-foreground hover:border-slate-300"}`}
                          >
                            {p === "low" ? "낮음" : p === "medium" ? "중간" : "높음"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">초기 상태</label>
                      <select value={fStatus} onChange={(e) => setFStatus(e.target.value as TaskStatus)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400">
                        <option value="todo">할 일</option><option value="inprogress">진행 중</option><option value="blocked">보류/블로커</option><option value="done">완료</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">완료 기준</label>
                    <input
                      value={fCriteria}
                      onChange={(e) => setFCriteria(e.target.value)}
                      placeholder="이 업무가 완료로 볼 수 있는 기준을 입력하세요"
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Category-specific */}
            {step === 2 && (
              <div>
                <div className="flex items-center gap-2 mb-4"><CatTag catId={selCat} /><h2 className="text-lg font-bold text-foreground">카테고리 전용 정보</h2></div>
                <div className="space-y-4">
                  {(CAT_MODAL_FIELDS[selCat] ?? CAT_MODAL_FIELDS["other"]).map(([label, placeholder]) => (
                    <div key={label}>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">{label}</label>
                      <input
                        value={fExtraFields[label] ?? ""}
                        onChange={(e) => setFExtraFields((cur) => ({ ...cur, [label]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Done */}
            {step === 3 && (
              <div className="flex flex-col items-center text-center py-10">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}>
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <div className="text-xl font-bold text-foreground mb-2">업무가 생성되었습니다!</div>
                <p className="text-sm text-muted-foreground mb-2"><CatTag catId={selCat} /> 카테고리로 등록되었습니다.</p>
                <p className="text-sm font-semibold text-foreground mb-6">"{fTitle || "새 업무"}"</p>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-5 py-2 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors">보드로 돌아가기</button>
                  <button
                    onClick={() => { setStep(0); setSelCat(""); setFTitle(""); setFDesc(""); setFCriteria(""); }}
                    className="px-5 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
                    style={{ background: "var(--primary)" }}
                  >
                    + 업무 더 추가
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Modal footer */}
          {step < 3 && (
            <div className="flex flex-col gap-2 px-6 py-4 border-t border-border">
              {submitError && <div className="text-xs text-red-600">{submitError}</div>}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />{step === 0 ? "취소" : "이전"}
                </button>
                <button
                  onClick={handleNext}
                  disabled={(step === 0 && !selCat) || submitting}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
                >
                  {step === 2 ? (submitting ? "생성 중..." : "업무 생성 완료") : "다음 단계"}<ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
