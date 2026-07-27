import { useDrop } from "react-dnd";
import { TaskCard } from "./TaskCard";
import { TASK_DRAG_TYPE, type TaskDragItem } from "../libs/utils/dnd";
import type { MemberResponse } from "../../global/api/projectsApi";
import type { Task, TaskStatus } from "../libs/types/task";

export interface BoardColumnDef {
  id: TaskStatus;
  label: string;
  color: string;
  bg: string;
}

interface KanbanColumnProps {
  col: BoardColumnDef;
  tasks: Task[];
  projectMembers: MemberResponse[];
  compact?: boolean;
  selectedId: string | null;
  onSelectTask: (id: string) => void;
  onDropTask: (taskId: string, status: TaskStatus) => void;
  onReorderTask: (draggedId: string, targetId: string, position: "before" | "after") => void;
}

export function KanbanColumn({ col, tasks, projectMembers, compact, selectedId, onSelectTask, onDropTask, onReorderTask }: KanbanColumnProps) {
  const [{ isOver, isEmptyAreaOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: TASK_DRAG_TYPE,
      drop: (item: TaskDragItem, monitor) => {
        if (monitor.didDrop()) return;
        if (item.status !== col.id) onDropTask(item.id, col.id);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        isEmptyAreaOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [col.id, onDropTask]
  );

  const isDropTarget = isOver && canDrop;
  const showEmptyAreaIndicator = isEmptyAreaOver && canDrop;

  return (
    <div
      ref={dropRef}
      className={`h-full min-w-0 min-h-0 flex flex-col rounded-xl transition-shadow ${isDropTarget ? "ring-2 ring-blue-400" : ""}`}
      style={{ background: col.bg }}
    >
      <div className={`flex items-center justify-between shrink-0 ${compact ? "px-2.5 py-2" : "px-4 py-3"}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: col.color }} />
          <span className={`font-semibold truncate ${compact ? "text-xs" : "text-sm"}`} style={{ color: col.color }}>
            {col.label}
          </span>
          <span className="text-[10px] font-mono bg-white rounded-full px-1.5 py-0.5 border border-border text-muted-foreground shrink-0">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto min-h-0 space-y-2 scrollbar-thin ${compact ? "px-2 pb-2" : "px-3 pb-3"}`}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            catId={task.category}
            projectMembers={projectMembers}
            compact={compact}
            selected={selectedId === task.id}
            onSelect={() => onSelectTask(task.id)}
            onReorder={onReorderTask}
          />
        ))}

        {showEmptyAreaIndicator && (
          <div className="border-2 border-dashed border-blue-400 rounded-xl h-12 flex items-center justify-center text-[10px] text-blue-500 font-medium">
            여기에 놓기
          </div>
        )}
      </div>
    </div>
  );
}
