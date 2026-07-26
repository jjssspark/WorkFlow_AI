import { apiFetch, API_BASE_URL } from "./apiClient";
import { tokenStore } from "./tokenStore";

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  content: string | null;
  targetType: string | null;
  targetId: string | null;
  read: boolean;
  createdAt: string;
}

export const ACTION_REQUIRED_NOTIFICATION_TYPES = new Set([
  "MEETING_ANALYSIS_COMPLETED_NOTIFY_LEADER",
  "MEETING_SAVED_NOTIFY_LEADER",
  "MEETING_EDITED",
]);

export function fetchNotifications(): Promise<NotificationResponse[]> {
  return apiFetch<NotificationResponse[]>("/notifications");
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count } = await apiFetch<{ count: number }>("/notifications/unread-count");
  return count;
}

// 서버가 이 id들만 읽음 처리한다. "전체 읽음"이 아니라 방금 화면에 보여준 것만 넘겨야,
// 목록을 불러온 뒤 새로 도착한 알림이 사용자가 보지도 못한 채로 읽음 처리되지 않는다.
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await apiFetch<null>("/notifications/read", {
    method: "PATCH",
    body: JSON.stringify({ ids: ids.map(Number) }),
  });
}

export interface NotificationStreamHandlers {
  onNotification: (notification: NotificationResponse) => void;
  onConnectedChange?: (connected: boolean) => void;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

/**
 * 인증이 Bearer 헤더 방식이라 네이티브 EventSource(커스텀 헤더 불가)를 못 쓰고,
 * fetch + ReadableStream으로 SSE 프레임을 직접 파싱한다. 연결이 끊기면 지수 백오프로
 * 재연결하고, 탭이 다시 보이거나 네트워크가 복구되면 즉시 재시도한다.
 */
export function subscribeNotificationStream(handlers: NotificationStreamHandlers, signal: AbortSignal): void {
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // visibilitychange/online 이벤트가 기존 연결이 살아있는 동안에도 발생할 수 있어,
  // 이 가드가 없으면 같은 스트림에 중복 구독이 생겨 알림이 두 번씩 전달된다.
  let isConnected = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = async () => {
    if (signal.aborted || isConnected) return;
    const accessToken = tokenStore.getAccessToken();
    if (!accessToken) return;

    // fetch()가 응답을 받기 전(await 도중)에도 재접속 이벤트가 들어올 수 있어,
    // 응답 완료 후가 아니라 여기서 동기적으로 먼저 잠가야 그 사이의 중복 호출도 막힌다.
    isConnected = true;
    try {
      const response = await fetch(`${API_BASE_URL}/notifications/stream`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`알림 스트림 연결 실패: ${response.status}`);

      handlers.onConnectedChange?.(true);
      attempt = 0;
      await readStream(response.body, handlers.onNotification);
    } catch {
      if (signal.aborted) return;
    } finally {
      isConnected = false;
      handlers.onConnectedChange?.(false);
      if (!signal.aborted) scheduleReconnect();
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      clearReconnectTimer();
      connect();
    }
  };
  const handleOnline = () => {
    clearReconnectTimer();
    connect();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", handleOnline);
  signal.addEventListener("abort", () => {
    clearReconnectTimer();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("online", handleOnline);
  });

  connect();
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  onNotification: (notification: NotificationResponse) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      parseEvent(rawEvent, onNotification);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

function parseEvent(rawEvent: string, onNotification: (notification: NotificationResponse) => void): void {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return; // 하트비트(주석 전용) 등 data 없는 프레임은 무시

  try {
    onNotification(JSON.parse(dataLines.join("\n")) as NotificationResponse);
  } catch {
    // 파싱 불가능한 프레임은 조용히 무시한다
  }
}
