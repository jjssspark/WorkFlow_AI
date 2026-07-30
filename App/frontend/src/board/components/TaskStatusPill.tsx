import type { TaskStatus } from "../libs/types/task";

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const map = {
    done:       { cls: "bg-emerald-100 text-emerald-700", label: "완료" },
    inprogress: { cls: "bg-blue-100 text-blue-700",       label: "진행 중" },
    todo:       { cls: "bg-slate-100 text-slate-600",     label: "대기" },
    blocked:    { cls: "bg-red-100 text-red-700",         label: "검토 필요" },
  };
  const s = map[status];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}
