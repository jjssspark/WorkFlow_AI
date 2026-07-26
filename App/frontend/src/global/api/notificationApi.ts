import { apiFetch } from "./apiClient";

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
