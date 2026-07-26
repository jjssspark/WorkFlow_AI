import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fetchUnreadNotificationCount,
  subscribeNotificationStream,
  type NotificationResponse,
} from "../api/notificationApi";
import { useAuth } from "./useAuth";
import { NotificationToast } from "../component/layout/NotificationToast";

const FALLBACK_POLL_INTERVAL_MS = 60_000;
const TOAST_DURATION_MS = 5_000;

interface NotificationsState {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await fetchUnreadNotificationCount();
      setUnreadCount(count);
    } catch (err) {
      console.error("안 읽은 알림 개수를 불러오지 못했습니다.", err);
    }
  }, []);

  const handleNotification = useCallback((notification: NotificationResponse) => {
    setUnreadCount((prev) => prev + 1);
    toast.custom(
      (toastId) => <NotificationToast notification={notification} toastId={toastId} />,
      { duration: TOAST_DURATION_MS }
    );
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }

    refreshUnreadCount();
    const controller = new AbortController();
    subscribeNotificationStream({ onNotification: handleNotification }, controller.signal);

    // SSE가 조용히 끊긴 채 재연결에 실패하는 경우를 대비한 안전망. 주 배송 경로는 SSE다.
    const interval = setInterval(refreshUnreadCount, FALLBACK_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isAuthenticated, handleNotification, refreshUnreadCount]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refreshUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
