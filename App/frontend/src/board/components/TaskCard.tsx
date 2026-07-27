import { useRef } from "react";
import { useDrag, useDrop } from "react-dnd";
import { CatTag } from "./CatTag";
import { PriorityBadge } from "./PriorityBadge";
import { PARTICIPANT_COLORS } from "../../global/lib/mock/members";
import { useAuth } from "../../global/hooks/useAuth";
import type { MemberResponse } from "../../global/api/projectsApi";
import { TASK_DRAG_TYPE, type TaskDragItem } from "../libs/utils/dnd";
import { canMoveTask } from "../libs/utils/taskActions";
import { formatDueDate } from "../libs/utils/taskService";
import type { Task } from "../libs/types/task";

interface TaskCardProps {
  task: Task;
  catId: string;
  projectMembers: MemberResponse[];
  compact?: boolean;
  selected?: boolean;
  onSelect: () => void;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
}

export function TaskCard({ task, catId, projectMembers, compact, selected, onSelect, onReorder }: TaskCardProps) {
  const m = projectMembers.find(me => String(me.userId) === task.assignee);
  const ref = useRef<HTMLDivElement>(null);
  const { user, currentProject } = useAuth();
  const canMove = canMoveTask(currentProject?.role === "팀장", task, user?.id) && !task.pendingApproval;

  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: TASK_DRAG_TYPE,
      item: { id: task.id, status: task.status },
      canDrag: () => canMove,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [task.id, task.status, canMove]
  );

  const [{ isOver, insertPosition }, dropRef] = useDrop<TaskDragItem, void, { isOver: boolean; insertPosition: "before" | "after" | null }>(
    () => ({
      accept: TASK_DRAG_TYPE,
      canDrop: (item) => item.id !== task.id,
      drop: (item, monitor) => {
        if (item.id === task.id) return;
        const clientOffset = monitor.getClientOffset();
        const rect = ref.current?.getBoundingClientRect();
        const after = clientOffset && rect ? clientOffset.y > rect.top + rect.height / 2 : false;
        onReorder(item.id, task.id, after ? "after" : "before");
      },
      collect: (monitor) => {
        const item = monitor.getItem();
        const clientOffset = monitor.getClientOffset();
        const rect = ref.current?.getBoundingClientRect();
        const after = clientOffset && rect ? clientOffset.y > rect.top + rect.height / 2 : false;
        return {
          isOver: monitor.isOver({ shallow: true }) && Boolean(item) && item.id !== task.id,
          insertPosition: after ? "after" : "before",
        };
      },
    }),
    [task.id, onReorder]
  );

  const setRefs = (node: HTMLDivElement | null) => {
    ref.current = node;
    dragRef(node);
    dropRef(node);
  };

  return (
    <div className="relative">
      {isOver && insertPosition === "before" && (
        <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full bg-blue-400 z-10" />
      )}
      <div
        ref={setRefs}
        onClick={onSelect}
        className={`rounded-xl border transition-all hover:shadow-md ${canMove ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${compact ? "p-2.5" : "p-3"} ${
          task.pendingApproval ? "bg-muted/60 grayscale-[40%]" : "bg-card"
        } ${
          selected ? "border-blue-400 shadow-md ring-1 ring-blue-200" : "border-border shadow-sm hover:border-slate-300"
        }`}
        style={{ opacity: isDragging ? 0.4 : task.pendingApproval ? 0.75 : 1 }}
      >
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <CatTag catId={catId} />
          {task.pendingApproval ? (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">승인 대기중</span>
          ) : task.status === "blocked" && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 shrink-0">블로커</span>
          )}
        </div>
        <div className={`font-semibold text-foreground mb-2 leading-snug ${compact ? "text-[11px] line-clamp-2" : "text-xs"}`}>
          {task.title}
        </div>
        <div className="flex items-center justify-between gap-1.5">
          <PriorityBadge priority={task.priority} />
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-muted-foreground">
              {task.startDate ? `${formatDueDate(task.startDate)} → ${formatDueDate(task.dueDate)}` : formatDueDate(task.dueDate)}
            </span>
            {m && (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                style={{ background: PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length] }}
              >
                {m.name.slice(0, 1)}
              </div>
            )}
          </div>
        </div>
      </div>
      {isOver && insertPosition === "after" && (
        <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-blue-400 z-10" />
      )}
    </div>
  );
}
