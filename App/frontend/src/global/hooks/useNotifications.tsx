import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  /**
   * 프로젝트 화면(AppShell)이 열려 있는 동안 그 프로젝트 id를 등록한다. 프로젝트 진입 화면처럼
   * AppShell 밖에서는 null. NotificationProvider가 RouterProvider 바깥에 있어 라우터로는
   * 현재 화면을 알 수 없으므로, 화면 쪽이 직접 알려주는 구조다.
   */
  setActiveProjectId: (projectId: number | null) => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, currentProjectId, projectContextReady } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  // 프로젝트를 옮겨 다닐 때마다 밀린 알림을 다시 띄우지 않도록, 이미 보여준 알림을 기억한다.
  const toastedIds = useRef(new Set<string>());

  const refreshUnreadCount = useCallback(async () => {
    if (!currentProjectId || currentProjectId < 0) return;
    try {
      const count = await fetchUnreadNotificationCount(currentProjectId);
      setUnreadCount(count);
    } catch (err) {
      console.error("안 읽은 알림 개수를 불러오지 못했습니다.", err);
    }
  }, [currentProjectId]);

  // SSE 구독은 로그인당 한 번만 열어야 한다. 콜백이 activeProjectId에 의존하면 프로젝트를 옮길
  // 때마다 스트림이 끊겼다 다시 붙으므로, 판정에 쓰는 값만 ref로 따로 들고 있는다.
  const activeProjectIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  /**
   * 지금 열려 있는 프로젝트 화면과 관계있는 알림인지. 프로젝트 진입 화면처럼 아직 어느 프로젝트를
   * 보는지 정해지지 않은 곳에서는 아무것도 띄우지 않는다. projectId가 없는 알림은 특정 프로젝트에
   * 매이지 않은 것이라 그대로 띄운다.
   */
  const belongsToActiveProject = useCallback((notification: NotificationResponse) => {
    const activeId = activeProjectIdRef.current;
    if (activeId === null) return false;
    // == null로 undefined까지 받는다. 응답에 projectId 필드가 아예 없으면(구버전 백엔드나
    // 직렬화 변경) === null은 false가 되고 Number(undefined)는 NaN이라 어떤 프로젝트와도
    // 일치하지 않는다. 그러면 "프로젝트에 매이지 않은 알림은 그대로 띄운다"는 의도가 정반대로
    // 뒤집혀 알림이 통째로 사라진다.
    return notification.projectId == null || Number(notification.projectId) === activeId;
  }, []);

  const showToast = useCallback((notification: NotificationResponse) => {
    if (!belongsToActiveProject(notification)) return;
    if (toastedIds.current.has(notification.id)) return;
    toastedIds.current.add(notification.id);
    toast.custom(
      (toastId) => <NotificationToast notification={notification} toastId={toastId} />,
      { duration: TOAST_DURATION_MS }
    );
  }, [belongsToActiveProject]);
  }, []);

  const handleNotification = useCallback((notification: NotificationResponse) => {
    // SSE는 사용자 단위로 구독하므로 다른 프로젝트의 알림도 도착한다.
    // 현재 보고 있는 프로젝트의 것만 화면에 반영한다.
    if (String(notification.projectId) !== String(currentProjectId)) return;
    setUnreadCount((prev) => prev + 1);
    showToast(notification);
  }, [showToast, currentProjectId]);

  /**
   * 아직 못 띄운 알림. 프로젝트에 들어오는 순간 네트워크를 기다리지 않고 곧바로 띄우려고, 목록을
   * 미리 받아 여기에 담아둔다. 진입 화면에 머무는 동안 SSE로 새로 도착한 것도 여기에 쌓인다.
   */
  const pending = useRef<NotificationResponse[]>([]);

  /** 대기 중인 알림 중 지금 화면과 관계있는 것을 즉시 띄운다. 비동기 작업이 없어 진입 즉시 뜬다. */
  const flushPending = useCallback(() => {
    if (activeProjectIdRef.current === null) return;
    const ready = pending.current.filter(belongsToActiveProject);
    pending.current = pending.current.filter((n) => !belongsToActiveProject(n));
    // 목록이 최신순이라 그대로 띄우면 가장 오래된 게 맨 위에 남는다 - 뒤집어서 최신이 위로 오게 한다.
    ready.slice(0, MAX_PENDING_TOASTS).reverse().forEach(showToast);
  }, [belongsToActiveProject, showToast]);

  const handleNotification = useCallback((notification: NotificationResponse) => {
    setUnreadCount((prev) => prev + 1);
    // 지금 못 띄우는 알림(진입 화면이거나 다른 프로젝트)은 버리지 않고 쌓아뒀다가 나중에 띄운다.
    if (belongsToActiveProject(notification)) showToast(notification);
    else pending.current.push(notification);
  }, [belongsToActiveProject, showToast]);
  const showPendingNotifications = useCallback(async () => {
    if (!currentProjectId || currentProjectId < 0) return;
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
    if (!isAuthenticated || !projectContextReady || !currentProjectId || currentProjectId < 0) {
      setUnreadCount(0);
      toastedIds.current.clear();
      pending.current = [];
      return;
    }

    refreshUnreadCount();
    const controller = new AbortController();
    subscribeNotificationStream({ onNotification: handleNotification }, controller.signal);

    // 자리를 비운 사이 쌓인 알림은 프로젝트에 들어와야 띄울 수 있지만, 목록을 받아오는 일은 지금
    // 미리 해둔다. 진입 시점에 요청을 걸면 왕복이 끝날 때까지 알림이 늦게 뜬다.
    fetchNotifications()
      .then((notifications) => {
        pending.current.push(...notifications.filter((n) => !n.read));
        flushPending();
      })
      .catch((err) => console.error("미확인 알림을 불러오지 못했습니다.", err));

    // SSE가 조용히 끊긴 채 재연결에 실패하는 경우를 대비한 안전망. 주 배송 경로는 SSE다.
    const interval = setInterval(refreshUnreadCount, FALLBACK_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isAuthenticated, handleNotification, refreshUnreadCount, flushPending]);

  // 프로젝트에 들어오거나 다른 프로젝트로 옮긴 순간, 그 프로젝트의 밀린 알림을 바로 띄운다.
  useEffect(() => {
    if (!isAuthenticated || activeProjectId === null) return;
    flushPending();
  }, [isAuthenticated, activeProjectId, flushPending]);
  }, [isAuthenticated, projectContextReady, currentProjectId, handleNotification, refreshUnreadCount, showPendingNotifications]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refreshUnreadCount, setActiveProjectId }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
