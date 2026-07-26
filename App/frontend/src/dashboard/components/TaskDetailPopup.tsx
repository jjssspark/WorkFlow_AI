import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { PriorityBadge } from "../../board/components/PriorityBadge";
import { TaskStatusPill } from "../../board/components/TaskStatusPill";
import type { DashboardTaskDto } from "../libs/types/dashboard";
import {
  createTaskComment,
  fetchTaskComments,
  type TaskCommentDto,
} from "../../board/libs/utils/taskCommentApi";
import { formatDashboardDueDate, normalizePriority, normalizeTaskStatus, sourceLabel } from "../libs/utils/dashboardTaskUtils";

interface TaskDetailPopupProps {
  task: DashboardTaskDto;
  projectId: number;
  onClose: () => void;
  /** 댓글 이모지로 열었을 때 댓글란까지 스크롤해 보여준다. */
  focusComments?: boolean;
}

export function TaskDetailPopup({ task, projectId, onClose, focusComments = false }: TaskDetailPopupProps) {
  const [comments, setComments] = useState<TaskCommentDto[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const commentsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    fetchTaskComments(task.id, projectId)
      .then(result => { if (!cancelled) setComments(result); })
      .catch(() => { if (!cancelled) setComments([]); })
      .finally(() => { if (!cancelled) setCommentsLoading(false); });
    return () => { cancelled = true; };
  }, [task.id, projectId]);

  useEffect(() => {
    if (focusComments && !commentsLoading) {
      commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusComments, commentsLoading]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const created = await createTaskComment(task.id, newComment.trim(), projectId);
      setComments(prev => [...prev, created]);
      setNewComment("");
    } catch {
      // 댓글 작성 실패는 입력값을 유지한 채 조용히 무시 — 사용자가 다시 시도할 수 있다.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <div className="text-[10px] font-mono text-muted-foreground">{task.id}</div>
              <h2 className="text-lg font-bold text-foreground">{task.title}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <TaskStatusPill status={normalizeTaskStatus(task.status)} />
              <PriorityBadge priority={normalizePriority(task.priority)} />
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{task.category ?? "미분류"}</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{sourceLabel(task.sourceType)}</span>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">업무 설명</div>
              <p className="text-sm text-foreground leading-relaxed">{task.description || "등록된 설명이 없습니다."}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">담당자</div>
                <div className="text-xs font-medium text-foreground">{task.assigneeName ?? "미배정"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">마감일</div>
                <div className="text-xs font-medium text-foreground">{formatDashboardDueDate(task.dueDate)}</div>
              </div>
            </div>

            <div ref={commentsRef} className="pt-2 border-t border-border">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" /> 댓글 {comments.length > 0 && `(${comments.length})`}
              </div>
              <div className="space-y-2.5 mb-3">
                {commentsLoading ? (
                  <div className="text-xs text-muted-foreground">댓글을 불러오는 중입니다</div>
                ) : comments.length === 0 ? (
                  <div className="text-xs text-muted-foreground">등록된 댓글이 없습니다.</div>
                ) : comments.map(comment => (
                  <div key={comment.id} className="rounded-lg bg-muted/50 px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{comment.authorName}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" })}</span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{comment.content}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleAddComment(); }}
                  placeholder="댓글을 입력하세요"
                  className="flex-1 rounded-xl border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  onClick={handleAddComment}
                  disabled={submitting || !newComment.trim()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
                  style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
