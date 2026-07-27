import { Bell, X } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ACTION_REQUIRED_NOTIFICATION_TYPES,
  markNotificationsRead,
  meetingNotificationPanelQuery,
  type NotificationResponse,
} from "../../api/notificationApi";

type Props = {
  notification: NotificationResponse;
  toastId: string | number;
};

export function NotificationToast({ notification, toastId }: Props) {
  const navigate = useNavigate();
  const isActionRequired = ACTION_REQUIRED_NOTIFICATION_TYPES.has(notification.type);
  const hasTarget =
    (notification.targetType === "meeting" || notification.targetType === "evaluation") &&
    !!notification.targetId;

  const handleActivate = () => {
    markNotificationsRead([notification.id]).catch((err) => {
      console.error("알림 읽음 처리에 실패했습니다.", err);
    });
    if (notification.targetType === "meeting" && notification.targetId) {
      navigate(`/meetings?meetingId=${notification.targetId}${meetingNotificationPanelQuery(notification.type)}`);
    } else if (notification.targetType === "evaluation" && notification.targetId) {
      navigate("/mypage");
    }
    toast.dismiss(toastId);
  };

  return (
    <div
      role="alert"
      onClick={handleActivate}
      className="flex w-80 cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-md transition-transform hover:-translate-y-0.5"
    >
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isActionRequired ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
        }`}
      >
        <Bell className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isActionRequired && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold">할 일</span>
          )}
          <div className="truncate text-sm font-semibold text-foreground">{notification.title}</div>
          {/* 5초 뒤 자동으로 사라지지만, 그 전에 직접 닫을 수도 있어야 한다. */}
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={(e) => {
              e.stopPropagation();
              toast.dismiss(toastId);
            }}
            className="ml-auto -mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {notification.content && <div className="mt-0.5 text-xs text-muted-foreground">{notification.content}</div>}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {new Date(notification.createdAt).toLocaleString("ko-KR", {
              month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul",
            })}
          </span>
          {hasTarget && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleActivate();
              }}
              className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
            >
              바로가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
