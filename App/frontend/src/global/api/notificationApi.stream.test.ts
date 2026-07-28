import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeNotificationStream } from "./notificationApi";
import { tokenStore } from "./tokenStore";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("subscribeNotificationStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it("전체 이벤트가 한 chunk로 오면 알림을 파싱해 콜백한다", async () => {
    tokenStore.setTokens("access-token", "refresh-token");
    const notification = {
      id: "1", projectId: "1", type: "TASK_ASSIGNED", title: "제목", content: null,
      targetType: "task", targetId: "42", read: false, createdAt: "2026-07-26T00:00:00Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse([`event: notification\ndata: ${JSON.stringify(notification)}\n\n`])
    ));

    const controller = new AbortController();
    const onNotification = vi.fn();
    subscribeNotificationStream({ onNotification }, controller.signal);

    await vi.waitFor(() => expect(onNotification).toHaveBeenCalledWith(notification));
    controller.abort();
  });

  it("Authorization 헤더에 액세스 토큰을 담아 스트림 엔드포인트로 연결한다", async () => {
    tokenStore.setTokens("access-token-xyz", "refresh-token");
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    subscribeNotificationStream({ onNotification: vi.fn() }, controller.signal);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/notifications/stream");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer access-token-xyz");
    controller.abort();
  });

  it("이벤트가 여러 chunk에 걸쳐 나뉘어 와도 올바르게 조립해 파싱한다", async () => {
    tokenStore.setTokens("access-token", "refresh-token");
    const notification = {
      id: "2", projectId: "1", type: "MEETING_SAVED", title: "저장 완료", content: "내용",
      targetType: "meeting", targetId: "9", read: false, createdAt: "2026-07-26T00:00:01Z",
    };
    const full = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
    const mid = Math.floor(full.length / 2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([full.slice(0, mid), full.slice(mid)])));

    const controller = new AbortController();
    const onNotification = vi.fn();
    subscribeNotificationStream({ onNotification }, controller.signal);

    await vi.waitFor(() => expect(onNotification).toHaveBeenCalledWith(notification));
    controller.abort();
  });

  it("하트비트 주석 프레임은 무시한다", async () => {
    tokenStore.setTokens("access-token", "refresh-token");
    const notification = {
      id: "3", projectId: "1", type: "TASK_ASSIGNED", title: "제목", content: null,
      targetType: null, targetId: null, read: false, createdAt: "2026-07-26T00:00:02Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse([`: ping\n\n`, `event: notification\ndata: ${JSON.stringify(notification)}\n\n`])
    ));

    const controller = new AbortController();
    const onNotification = vi.fn();
    subscribeNotificationStream({ onNotification }, controller.signal);

    await vi.waitFor(() => expect(onNotification).toHaveBeenCalledTimes(1));
    expect(onNotification).toHaveBeenCalledWith(notification);
    controller.abort();
  });

  it("토큰이 없으면 연결을 시도하지 않는다", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    subscribeNotificationStream({ onNotification: vi.fn() }, controller.signal);
    controller.abort();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
