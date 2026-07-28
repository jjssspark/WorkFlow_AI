import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useEffect } from "react";
import { NotificationProvider, useNotifications } from "./useNotifications";
import type { NotificationResponse, TaskMoveEvent } from "../api/notificationApi";

vi.mock("sonner", () => ({ toast: { custom: vi.fn(), dismiss: vi.fn() } }));

const mockUseAuth = vi.fn();
vi.mock("./useAuth", () => ({ useAuth: () => mockUseAuth() }));

type StreamHandlers = {
  onNotification: (n: NotificationResponse) => void;
  onTaskMove?: (event: TaskMoveEvent) => void;
  onConnectedChange?: (connected: boolean) => void;
};
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

function Probe({ onTaskMoveEvents }: { onTaskMoveEvents?: (event: TaskMoveEvent) => void }) {
  const { unreadCount, subscribeTaskMove, isStreamConnected } = useNotifications();
  useEffect(() => {
    if (!onTaskMoveEvents) return;
    return subscribeTaskMove(onTaskMoveEvents);
  }, [subscribeTaskMove, onTaskMoveEvents]);
  return (
    <div>
      <div data-testid="count">{unreadCount}</div>
      <div data-testid="stream-connected">{String(isStreamConnected)}</div>
    </div>
  );
}

const CURRENT_PROJECT_ID = 12;

function sampleNotification(overrides: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: "1", projectId: String(CURRENT_PROJECT_ID), type: "TASK_ASSIGNED", title: "제목", content: null,
    targetType: null, targetId: null, read: false, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function authenticatedAuth(overrides: Record<string, unknown> = {}) {
  return { isAuthenticated: true, projectContextReady: true, currentProjectId: CURRENT_PROJECT_ID, ...overrides };
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
    mockUseAuth.mockReturnValue(authenticatedAuth());
    render(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchUnreadNotificationCount).toHaveBeenCalledWith(CURRENT_PROJECT_ID));
    expect(subscribeNotificationStream).toHaveBeenCalled();
  });

  it("비로그인 상태면 구독하지 않는다", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<NotificationProvider><Probe /></NotificationProvider>);

    expect(subscribeNotificationStream).not.toHaveBeenCalled();
  });

  it("projectId가 음수(로컬 전용 임시 프로젝트)면 알림 API를 호출하지 않는다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth({ currentProjectId: -1234 }));
    render(<NotificationProvider><Probe /></NotificationProvider>);

    // 음수 projectId는 아직 서버에 존재하지 않는 로컬 전용 프로젝트라, 그대로 요청하면
    // 서버가 403을 반환하고 60초 폴백 폴링이 이를 영원히 반복한다.
    await waitFor(() => expect(subscribeNotificationStream).not.toHaveBeenCalled());
    expect(fetchUnreadNotificationCount).not.toHaveBeenCalled();
    expect(fetchNotifications).not.toHaveBeenCalled();
  });

  it("새 알림 수신 시 안읽음 개수를 올리고 토스트를 띄운다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const { getByTestId } = render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification(sampleNotification());
    });

    expect(getByTestId("count").textContent).toBe("1");
    expect(toast.custom).toHaveBeenCalledOnce();
  });

  it("다른 프로젝트의 알림이 도착하면 안읽음 개수를 올리지 않고 토스트도 띄우지 않는다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const { getByTestId } = render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onNotification(sampleNotification({ projectId: "99" }));
    });

    expect(getByTestId("count").textContent).toBe("0");
    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("접속하면 자리를 비운 사이 쌓인 안 읽은 알림을 최대 5건까지 토스트로 띄운다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    fetchNotifications.mockResolvedValue(notificationsOf(8));

    render(<NotificationProvider><Probe /></NotificationProvider>);

    // 8건이 밀려 있어도 화면을 덮지 않도록 5건까지만 띄운다.
    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(5));
  });

  it("이미 읽은 알림은 접속 시 다시 띄우지 않는다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    fetchNotifications.mockResolvedValue(notificationsOf(3, true));

    render(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("프로젝트 전환 전에 나간 미읽음 개수 요청이 전환 후에 뒤늦게 응답해도 최신 상태를 덮어쓰지 않는다", async () => {
    let resolveFirst!: (value: number) => void;
    let resolveSecond!: (value: number) => void;
    const firstRequest = new Promise<number>((resolve) => { resolveFirst = resolve; });
    const secondRequest = new Promise<number>((resolve) => { resolveSecond = resolve; });

    fetchUnreadNotificationCount
      .mockReset()
      .mockImplementationOnce(() => firstRequest)
      .mockImplementationOnce(() => secondRequest);

    mockUseAuth.mockReturnValue(authenticatedAuth({ currentProjectId: 12 }));
    const { getByTestId, rerender } = render(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(1));
    expect(fetchUnreadNotificationCount).toHaveBeenNthCalledWith(1, 12);

    // 프로젝트 12의 요청이 아직 응답하지 않은 채로 프로젝트 34로 전환한다.
    mockUseAuth.mockReturnValue(authenticatedAuth({ currentProjectId: 34 }));
    rerender(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(2));
    expect(fetchUnreadNotificationCount).toHaveBeenNthCalledWith(2, 34);

    // 새 프로젝트(34)의 응답이 먼저 도착한다.
    resolveSecond(5);
    await waitFor(() => expect(getByTestId("count").textContent).toBe("5"));

    // 이전 프로젝트(12)로 나갔던 요청이 전환 이후에야 뒤늦게 응답한다 - 이미 프로젝트 34를 보고
    // 있으므로 이 응답은 버려져야 하고, 화면의 미읽음 개수는 34의 값(5)을 계속 유지해야 한다.
    resolveFirst(99);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getByTestId("count").textContent).toBe("5");
  });

  it("task-move 이벤트를 구독한 컴포넌트에 재배포한다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const onTaskMoveEvents = vi.fn();
    render(<NotificationProvider><Probe onTaskMoveEvents={onTaskMoveEvents} /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    const event: TaskMoveEvent = { taskId: "42", projectId: String(CURRENT_PROJECT_ID), status: "inprogress", position: 1 };
    act(() => {
      streamHandlers!.onTaskMove?.(event);
    });

    expect(onTaskMoveEvents).toHaveBeenCalledWith(event);
  });

  it("구독을 해제하면 이후 이벤트를 더는 받지 않는다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const onTaskMoveEvents = vi.fn();
    const { unmount } = render(<NotificationProvider><Probe onTaskMoveEvents={onTaskMoveEvents} /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());
    unmount();

    const event: TaskMoveEvent = { taskId: "42", projectId: String(CURRENT_PROJECT_ID), status: "inprogress", position: 1 };
    streamHandlers!.onTaskMove?.(event);

    expect(onTaskMoveEvents).not.toHaveBeenCalled();
  });

  it("스트림이 연결되면 isStreamConnected가 true가 된다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const { getByTestId } = render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onConnectedChange?.(true);
    });

    expect(getByTestId("stream-connected").textContent).toBe("true");
  });

  it("연결된 상태에서 얼리리턴 조건(비로그인)이 되면 isStreamConnected가 다시 false가 된다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const { getByTestId, rerender } = render(<NotificationProvider><Probe /></NotificationProvider>);
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    act(() => {
      streamHandlers!.onConnectedChange?.(true);
    });
    expect(getByTestId("stream-connected").textContent).toBe("true");

    // 연결되어 있던 도중 로그아웃 등으로 effect가 얼리리턴하면, 남아있던 true가 아니라
    // 반드시 false로 리셋되어야 한다.
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    rerender(<NotificationProvider><Probe /></NotificationProvider>);

    expect(getByTestId("stream-connected").textContent).toBe("false");
  });

  it("리스너 중 하나가 예외를 던져도 이후 등록된 다른 리스너는 정상적으로 이벤트를 받는다", async () => {
    mockUseAuth.mockReturnValue(authenticatedAuth());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingListener = vi.fn(() => {
      throw new Error("boom");
    });
    const okListener = vi.fn();

    render(
      <NotificationProvider>
        <Probe onTaskMoveEvents={throwingListener} />
        <Probe onTaskMoveEvents={okListener} />
      </NotificationProvider>
    );
    await waitFor(() => expect(subscribeNotificationStream).toHaveBeenCalled());

    const event: TaskMoveEvent = { taskId: "42", projectId: String(CURRENT_PROJECT_ID), status: "inprogress", position: 1 };
    act(() => {
      streamHandlers!.onTaskMove?.(event);
    });

    expect(throwingListener).toHaveBeenCalledWith(event);
    expect(okListener).toHaveBeenCalledWith(event);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
