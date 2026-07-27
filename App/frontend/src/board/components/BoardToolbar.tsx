import { Plus } from "lucide-react";
import { BOARD_COLS } from "../libs/mock/tasks";
import { useAuth } from "../../global/hooks/useAuth";
import type { Task, TaskStatus } from "../libs/types/task";

interface BoardToolbarProps {
  tasks: Task[];
  compact?: boolean;
  onAddTask: (status: TaskStatus) => void;
}

export function BoardToolbar({ tasks, compact, onAddTask }: BoardToolbarProps) {
  const { currentProject } = useAuth();
  const isLeader = currentProject?.role === "팀장";

  return (
    <div className={`flex items-center justify-between shrink-0 border-b border-border ${compact ? "px-3 py-2.5" : "px-5 py-3.5"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <h1 className={`font-bold text-foreground shrink-0 ${compact ? "text-sm" : "text-base"}`}>업무 보드</h1>
        {!compact && (
          <div className="flex items-center gap-1.5">
            {BOARD_COLS.map((col) => (
              <span
                key={col.id}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: col.bg, color: col.color }}
              >
                {col.label} {tasks.filter((t) => t.status === col.id).length}
              </span>
            ))}
          </div>
        )}
      </div>
      {isLeader && (
        <button
          onClick={() => onAddTask("todo")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90 transition-opacity shrink-0"
          style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
        >
          <Plus className="w-3.5 h-3.5" />새 업무
        </button>
      )}
    </div>
  );
}
