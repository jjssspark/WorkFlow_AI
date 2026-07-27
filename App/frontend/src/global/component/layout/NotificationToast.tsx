import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ACTION_REQUIRED_NOTIFICATION_TYPES,
  markNotificationsRead,
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
      navigate(`/meetings?meetingId=${notification.targetId}`);
    } else if (notification.targetType === "evaluation" && notification.targetId) {
      navigate("/mypage");
    }
    toast.dismiss(toastId);
  };

  return (
    <div
      role="alert"
      onClick={handleActivate}
      className={`relative w-80 cursor-pointer rounded-2xl border p-4 shadow-lg transition-transform hover:-translate-y-0.5 ${
        isActionRequired ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-card"
      }`}
    >
      <div
        aria-hidden="true"
        className={`absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r ${
          isActionRequired ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-card"
        }`}
      />
      <div className="flex items-center gap-1.5">
        {isActionRequired && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold">할 일</span>
        )}
        <div className="text-sm font-semibold text-foreground">{notification.title}</div>
      </div>
      {notification.content && <div className="text-xs text-muted-foreground mt-1">{notification.content}</div>}
      <div className="text-[10px] text-muted-foreground mt-1">
        {new Date(notification.createdAt).toLocaleString("ko-KR", {
          month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul",
        })}
      </div>
      {hasTarget && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleActivate();
          }}
          className="mt-2 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
        >
          바로가기
        </button>
      )}
    </div>
  );
}
