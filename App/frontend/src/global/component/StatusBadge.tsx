import type { TaskStatus } from "../../board/libs/types/task";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = { done:{ cls:"bg-emerald-100 text-emerald-700",l:"완료"}, inprogress:{cls:"bg-blue-100 text-blue-700",l:"진행 중"}, todo:{cls:"bg-slate-100 text-slate-600",l:"대기"}, blocked:{cls:"bg-red-100 text-red-700",l:"검토 필요"} };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${m[status].cls}`}>{m[status].l}</span>;
}
