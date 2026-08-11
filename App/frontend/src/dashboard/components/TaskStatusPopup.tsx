import { useState } from "react";
import { X } from "lucide-react";
import { TaskStatusPill } from "../../board/components/TaskStatusPill";
import type { TaskStatus } from "../../board/libs/types/task";
import { updateTaskPosition } from "../../board/libs/utils/taskApi";
import type { DashboardTaskDto } from "../libs/types/dashboard";
import { nextPositionForStatus, normalizeTaskStatus } from "../libs/utils/dashboardTaskUtils";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "inprogress", "blocked", "done"];

interface TaskStatusPopupProps {
  task: DashboardTaskDto;
  /** 대상 컬럼 끝 position을 계산하기 위한 같은 프로젝트의 전체 업무 목록. */
  tasks: DashboardTaskDto[];
  projectId: number;
  onClose: () => void;
  onChanged: (newStatus: TaskStatus) => void;
}

export function TaskStatusPopup({ task, tasks, projectId, onClose, onChanged }: TaskStatusPopupProps) {
  const currentStatus = normalizeTaskStatus(task.status);
  const [selected, setSelected] = useState<TaskStatus>(currentStatus);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (selected === currentStatus) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 원래 있던 컬럼의 position을 그대로 넘기면 대상 컬럼(selected)의 기존 카드와
      // 값이 겹칠 수 있어, 보드 드래그앤드롭과 동일한 규칙으로 대상 컬럼 끝에 이어붙인다.
      await updateTaskPosition(task.id, selected, nextPositionForStatus(tasks, selected), projectId);
      alert("변경이 완료되었습니다.");
      onChanged(selected);
    } catch {
      setError("업무 상태 변경에 실패했습니다. 잠시 후 다시 시도해주세요.");
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
            <h2 className="text-base font-bold text-foreground">업무 상태 변경</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <div className="p-6 space-y-2">
            <div className="text-xs text-muted-foreground mb-2 truncate">{task.title}</div>
            {STATUS_OPTIONS.map(status => (
              <button
                key={status}
                onClick={() => setSelected(status)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${selected === status ? "border-blue-400 bg-blue-50" : "border-border hover:bg-muted"}`}
              >
                <TaskStatusPill status={status} />
                {selected === status && <span className="text-[10px] font-semibold text-blue-600">선택됨</span>}
              </button>
            ))}
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
