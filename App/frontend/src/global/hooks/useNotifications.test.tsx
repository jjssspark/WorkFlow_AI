import { useEffect } from "react";
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
const fetchNotifications = vi.fn();
const subscribeNotificationStream = vi.fn((handlers: StreamHandlers) => {
  streamHandlers = handlers;
});
vi.mock("../api/notificationApi", () => ({
  fetchUnreadNotificationCount: (...args: unknown[]) => fetchUnreadNotificationCount(...args),
  fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
  subscribeNotificationStream: (...args: unknown[]) => subscribeNotificationStream(...(args as [StreamHandlers, AbortSignal])),
}));

const ACTIVE_PROJECT_ID = 1;

/** 프로젝트 화면(AppShell)이 열린 상태를 흉내낸다. null이면 프로젝트 진입 화면에 있는 상태다. */
function Probe({ activeProjectId = ACTIVE_PROJECT_ID }: { activeProjectId?: number | null }) {
  const { unreadCount, setActiveProjectId } = useNotifications();
  useEffect(() => {
    setActiveProjectId(activeProjectId);
    return () => setActiveProjectId(null);
  }, [activeProjectId, setActiveProjectId]);
  return <div data-testid="count">{unreadCount}</div>;
}

function sampleNotification(): NotificationResponse {
  return {
    id: "1", type: "TASK_ASSIGNED", title: "제목", content: null,
    targetType: null, targetId: null, projectId: String(ACTIVE_PROJECT_ID),
    read: false, createdAt: new Date().toISOString(),
  };
}

function notificationsOf(count: number, read = false): NotificationResponse[] {
  return Array.from({ length: count }, (_, i) => ({
    ...sampleNotification(),
    id: String(i + 1),
    title: `알림${i + 1}`,
    read,
  }));
}

describe("NotificationProvider", () => {
  beforeEach(() => {
    streamHandlers = null;
    fetchUnreadNotificationCount.mockReset().mockResolvedValue(0);
    fetchNotifications.mockReset().mockResolvedValue([]);
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

  it("접속하면 자리를 비운 사이 쌓인 안 읽은 알림을 최대 5건까지 토스트로 띄운다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    fetchNotifications.mockResolvedValue(notificationsOf(8));

    render(<NotificationProvider><Probe /></NotificationProvider>);

    // 8건이 밀려 있어도 화면을 덮지 않도록 5건까지만 띄운다.
    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(5));
  });

  it("이미 읽은 알림은 접속 시 다시 띄우지 않는다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    fetchNotifications.mockResolvedValue(notificationsOf(3, true));

    render(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("프로젝트 진입 화면에서는 알림이 와도 토스트를 띄우지 않는다", async () => {
    // 아직 어느 프로젝트를 보는지 정해지지 않은 화면이라, 특정 프로젝트의 소식을 띄울 자리가 아니다.
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    fetchNotifications.mockResolvedValue(notificationsOf(3));
    const { getByTestId } = render(
      <NotificationProvider><Probe activeProjectId={null} /></NotificationProvider>
    );
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification({ ...sampleNotification(), id: "99" });
    });

    // 배지 숫자는 올라가지만 화면을 덮는 토스트는 뜨지 않는다.
    expect(getByTestId("count").textContent).toBe("1");
    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("다른 프로젝트의 알림은 토스트를 띄우지 않는다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification({ ...sampleNotification(), id: "77", projectId: "999" });
    });

    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("어느 프로젝트에도 속하지 않는 알림은 그대로 띄운다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification({ ...sampleNotification(), id: "88", projectId: null });
    });

    expect(toast.custom).toHaveBeenCalledOnce();
  });

  it("진입 화면에서 놓친 알림을 프로젝트에 들어온 뒤 띄운다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    fetchNotifications.mockResolvedValue(notificationsOf(2));
    const { rerender } = render(
      <NotificationProvider><Probe activeProjectId={null} /></NotificationProvider>
    );
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());
    expect(toast.custom).not.toHaveBeenCalled();

    rerender(<NotificationProvider><Probe activeProjectId={ACTIVE_PROJECT_ID} /></NotificationProvider>);

    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(2));
  });

  it("프로젝트에 들어오는 순간 목록을 다시 불러오지 않고 미리 받아둔 것으로 바로 띄운다", async () => {
    // 진입 시점에 요청을 걸면 왕복이 끝날 때까지 알림이 늦게 뜬다. 목록은 로그인 직후에 받아둔다.
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    fetchNotifications.mockResolvedValue(notificationsOf(2));
    const { rerender } = render(
      <NotificationProvider><Probe activeProjectId={null} /></NotificationProvider>
    );
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(1));

    rerender(<NotificationProvider><Probe activeProjectId={ACTIVE_PROJECT_ID} /></NotificationProvider>);
    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(2));

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("진입 화면에서 도착한 실시간 알림도 프로젝트에 들어오면 띄운다", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    const { rerender } = render(
      <NotificationProvider><Probe activeProjectId={null} /></NotificationProvider>
    );
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification({ ...sampleNotification(), id: "55" });
    });
    expect(toast.custom).not.toHaveBeenCalled();

    rerender(<NotificationProvider><Probe activeProjectId={ACTIVE_PROJECT_ID} /></NotificationProvider>);

    await waitFor(() => expect(toast.custom).toHaveBeenCalledOnce());
  });
});
