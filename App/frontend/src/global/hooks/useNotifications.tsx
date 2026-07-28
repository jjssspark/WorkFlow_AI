import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  subscribeNotificationStream,
  type NotificationResponse,
} from "../api/notificationApi";
import { useAuth } from "./useAuth";
import { NotificationToast } from "../component/layout/NotificationToast";

const FALLBACK_POLL_INTERVAL_MS = 60_000;
const TOAST_DURATION_MS = 5_000;
/** 접속 시 밀린 알림을 한꺼번에 다 띄우면 화면을 덮으므로, 카톡처럼 최근 몇 건만 보여준다. */
const MAX_PENDING_TOASTS = 5;

interface NotificationsState {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, currentProjectId, projectContextReady } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    if (currentProjectId == null) return;
    try {
      const count = await fetchUnreadNotificationCount(currentProjectId);
      setUnreadCount(count);
    } catch (err) {
      console.error("안 읽은 알림 개수를 불러오지 못했습니다.", err);
    }
  }, [currentProjectId]);

  const showToast = useCallback((notification: NotificationResponse) => {
    toast.custom(
      (toastId) => <NotificationToast notification={notification} toastId={toastId} />,
      { duration: TOAST_DURATION_MS }
    );
  }, []);

  const handleNotification = useCallback((notification: NotificationResponse) => {
    // SSE는 사용자 단위로 구독하므로 다른 프로젝트의 알림도 도착한다.
    // 현재 보고 있는 프로젝트의 것만 화면에 반영한다.
    if (String(notification.projectId) !== String(currentProjectId)) return;
    setUnreadCount((prev) => prev + 1);
    showToast(notification);
  }, [showToast, currentProjectId]);

  /**
   * 자리를 비운 사이 쌓인(=아직 안 읽은) 알림을 접속 직후 카톡처럼 띄운다. SSE는 접속 이후에
   * 새로 발생한 것만 보내주므로, 그 전에 도착한 알림은 여기서만 볼 수 있다.
   */
  const showPendingNotifications = useCallback(async () => {
    if (currentProjectId == null) return;
    try {
      const notifications = await fetchNotifications(currentProjectId);
      // 목록이 최신순이라 그대로 띄우면 가장 오래된 게 맨 위에 남는다 - 뒤집어서 최신이 위로 오게 한다.
      const pending = notifications.filter((n) => !n.read).slice(0, MAX_PENDING_TOASTS).reverse();
      pending.forEach(showToast);
    } catch (err) {
      console.error("미확인 알림을 불러오지 못했습니다.", err);
    }
  }, [showToast, currentProjectId]);

  useEffect(() => {
    if (!isAuthenticated || !projectContextReady || currentProjectId == null) {
      setUnreadCount(0);
      return;
    }

    refreshUnreadCount();
    void showPendingNotifications();
    const controller = new AbortController();
    subscribeNotificationStream({ onNotification: handleNotification }, controller.signal);

    // SSE가 조용히 끊긴 채 재연결에 실패하는 경우를 대비한 안전망. 주 배송 경로는 SSE다.
    const interval = setInterval(refreshUnreadCount, FALLBACK_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isAuthenticated, projectContextReady, currentProjectId, handleNotification, refreshUnreadCount, showPendingNotifications]);

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
