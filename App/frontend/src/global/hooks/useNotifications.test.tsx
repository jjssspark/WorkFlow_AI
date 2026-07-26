import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { NotificationProvider, useNotifications } from "./useNotifications";
import type { NotificationResponse } from "../api/notificationApi";

vi.mock("sonner", () => ({ toast: { custom: vi.fn(), dismiss: vi.fn() } }));

const mockUseAuth = vi.fn();
vi.mock("./useAuth", () => ({ useAuth: () => mockUseAuth() }));

type StreamHandlers = { onNotification: (n: NotificationResponse) => void };
let streamHandlers: StreamHandlers | null = null;
const fetchUnreadNotificationCount = vi.fn();
const subscribeNotificationStream = vi.fn((handlers: StreamHandlers) => {
  streamHandlers = handlers;
});
vi.mock("../api/notificationApi", () => ({
  fetchUnreadNotificationCount: (...args: unknown[]) => fetchUnreadNotificationCount(...args),
  subscribeNotificationStream: (...args: unknown[]) => subscribeNotificationStream(...(args as [StreamHandlers, AbortSignal])),
}));

function Probe() {
  const { unreadCount } = useNotifications();
  return <div data-testid="count">{unreadCount}</div>;
}

function sampleNotification(): NotificationResponse {
  return {
    id: "1", type: "TASK_ASSIGNED", title: "제목", content: null,
    targetType: null, targetId: null, read: false, createdAt: new Date().toISOString(),
  };
}

describe("NotificationProvider", () => {
  beforeEach(() => {
    streamHandlers = null;
    fetchUnreadNotificationCount.mockReset().mockResolvedValue(0);
    subscribeNotificationStream.mockClear();
    vi.mocked(toast.custom).mockClear();
  });

  it("로그인 상태면 스트림을 구독하고 초기 안읽음 개수를 불러온다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchUnreadNotificationCount).toHaveBeenCalled());
    expect(subscribeNotificationStream).toHaveBeenCalled();
  });

  it("비로그인 상태면 구독하지 않는다", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<NotificationProvider><Probe /></NotificationProvider>);

    expect(subscribeNotificationStream).not.toHaveBeenCalled();
  });

  it("새 알림 수신 시 안읽음 개수를 올리고 토스트를 띄운다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    const { getByTestId } = render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification(sampleNotification());
    });

    expect(getByTestId("count").textContent).toBe("1");
    expect(toast.custom).toHaveBeenCalledOnce();
  });
});
