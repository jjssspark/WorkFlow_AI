import { useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useAuth } from "../../global/hooks/useAuth";
import { useProject } from "../../global/hooks/useProject";
import { updateProject, type ProjectResponse } from "../../global/api/projectsApi";

const PROJECT_TYPES = ["캡스톤디자인", "팀프로젝트", "공모전", "해커톤", "기타"];

/** 팀장만 프로젝트 정보를 수정할 수 있고, 팀원/심사자는 읽기 전용으로 본다. */
export function ProjectSettingsSection() {
  const { currentProject, currentProjectId, refreshMe } = useAuth();
  const project = useProject(currentProjectId);
  const isLeader = currentProject?.role === "팀장";

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProjectResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(project);
    setEditing(false);
    setError(null);
  }, [project]);

  if (!currentProjectId || currentProjectId < 0 || !project || !form) {
    return null;
  }

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError("프로젝트명은 비워둘 수 없습니다.");
      return;
    }
    if (form.startDate && form.deadline && form.startDate > form.deadline) {
      setError("시작일은 종료일보다 이전이어야 합니다.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject(project.id, {
        title: form.title,
        type: form.type ?? undefined,
        description: form.description ?? undefined,
        startDate: form.startDate ?? undefined,
        deadline: form.deadline ?? undefined,
        midCheckDate: form.midCheckDate ?? undefined,
        memberLimit: form.memberLimit ?? undefined,
        deliverables: form.deliverables ?? undefined,
        techStack: form.techStack ?? undefined,
        goals: form.goals ?? undefined,
      });
      setForm(updated);
      setEditing(false);
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="project-settings" className="bg-card border border-border rounded-xl p-5 shadow-sm scroll-mt-20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-foreground">프로젝트 정보</h2>
        {isLeader && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            <Pencil className="w-3.5 h-3.5" /> 수정
          </button>
        )}
        {isLeader && editing && (
          <button type="button" onClick={() => { setForm(project); setEditing(false); setError(null); }}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" /> 취소
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      {!editing ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="프로젝트명" value={project.title} />
          <Field label="유형" value={project.type ?? "미설정"} />
          <Field label="시작일" value={project.startDate ?? "미설정"} />
          <Field label="최종 마감일" value={project.deadline ?? "미설정"} />
          <Field label="중간 점검일" value={project.midCheckDate ?? "미설정"} />
          <Field label="예상 인원" value={`${project.memberLimit ?? 0}명 (현재 ${project.memberCount ?? 0}명)`} />
          <Field label="목표 산출물" value={project.deliverables?.join(", ") || "미설정"} />
          <Field label="기술 스택" value={project.techStack?.join(", ") || "미설정"} />
          <Field label="설명" value={project.description ?? "미설정"} full />
          <Field label="진행 목표/메모" value={project.goals ?? "미설정"} full />
        </dl>
      ) : (
        <div className="space-y-3">
          <LabeledInput label="프로젝트명" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">유형</label>
            <select
              value={form.type ?? ""}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">선택 안 함</option>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <LabeledInput type="date" label="시작일" value={form.startDate ?? ""} onChange={(v) => setForm({ ...form, startDate: v })} />
            <LabeledInput type="date" label="최종 마감일" value={form.deadline ?? ""} onChange={(v) => setForm({ ...form, deadline: v })} />
            <LabeledInput type="date" label="중간 점검일" value={form.midCheckDate ?? ""} onChange={(v) => setForm({ ...form, midCheckDate: v })} />
          </div>
          <LabeledInput type="number" label="예상 참여 인원 수" value={String(form.memberLimit ?? "")}
            onChange={(v) => setForm({ ...form, memberLimit: v ? Number(v) : null })} />
          <LabeledInput label="목표 산출물 (쉼표로 구분)" value={form.deliverables?.join(", ") ?? ""}
            onChange={(v) => setForm({ ...form, deliverables: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
          <LabeledInput label="기술 스택 (쉼표로 구분)" value={form.techStack?.join(", ") ?? ""}
            onChange={(v) => setForm({ ...form, techStack: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">설명</label>
            <textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">진행 목표/메모</label>
            <textarea value={form.goals ?? ""} onChange={(e) => setForm({ ...form, goals: e.target.value })}
              rows={2} className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none" />
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-foreground mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}
