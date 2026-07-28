import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface CommentDetailModalData {
  title: string;
  author: string;
  dateLabel?: string;
  content: string;
  reply?: { author: string; dateLabel?: string; content: string };
}

type Props = {
  data: CommentDetailModalData;
  onClose: () => void;
};

export function CommentDetailModal({ data, onClose }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={data.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-foreground">{data.title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-muted-foreground mb-1">
          {data.author}
          {data.dateLabel ? ` · ${data.dateLabel}` : ""}
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{data.content}</p>
        {data.reply && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground mb-1">
              답글 · {data.reply.author}
              {data.reply.dateLabel ? ` · ${data.reply.dateLabel}` : ""}
            </div>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{data.reply.content}</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
