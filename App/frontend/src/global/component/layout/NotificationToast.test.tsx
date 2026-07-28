import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { NotificationToast } from "./NotificationToast";
import { markNotificationsRead, type NotificationResponse } from "../../api/notificationApi";

vi.mock("../../api/notificationApi", async () => {
  const actual = await vi.importActual<typeof import("../../api/notificationApi")>("../../api/notificationApi");
  return { ...actual, markNotificationsRead: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("sonner", () => ({ toast: { dismiss: vi.fn() } }));

function renderToast(overrides: Partial<NotificationResponse> = {}) {
  const notification: NotificationResponse = {
    id: "1", projectId: "1", type: "TASK_ASSIGNED", title: "새 업무 배정", content: "'로그인 API' 업무가 배정되었습니다.",
    targetType: null, targetId: null, read: false, createdAt: new Date().toISOString(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <NotificationToast notification={notification} toastId="toast-1" />
    </MemoryRouter>
  );
  return notification;
}

describe("NotificationToast", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.mocked(markNotificationsRead).mockClear().mockResolvedValue(undefined);
    vi.mocked(toast.dismiss).mockClear();
  });

  it("액션필요 타입이 아니면 '할 일' 배지와 바로가기 버튼이 없다", () => {
    renderToast({ type: "TASK_ASSIGNED" });
    expect(screen.queryByText("할 일")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "바로가기" })).not.toBeInTheDocument();
  });

  it("액션필요 타입 + target 있으면 '할 일' 배지와 바로가기 버튼이 보인다", () => {
    renderToast({ type: "MEETING_SAVED_NOTIFY_LEADER", targetType: "meeting", targetId: "7" });
    expect(screen.getByText("할 일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "바로가기" })).toBeInTheDocument();
  });

  it("바로가기 클릭 시 읽음 처리하고 해당 회의록으로 이동한다", async () => {
    renderToast({ type: "MEETING_SAVED_NOTIFY_LEADER", targetType: "meeting", targetId: "7" });

    await userEvent.click(screen.getByRole("button", { name: "바로가기" }));

    expect(markNotificationsRead).toHaveBeenCalledWith(["1"]);
    expect(mockNavigate).toHaveBeenCalledWith("/meetings?meetingId=7");
  });

  it("업무 알림의 바로가기를 누르면 해당 업무 상세 딥링크로 이동한다", async () => {
    renderToast({ targetType: "task", targetId: "42", projectId: "1" });

    await userEvent.click(screen.getByRole("button", { name: "바로가기" }));

    expect(markNotificationsRead).toHaveBeenCalledWith(["1"]);
    expect(mockNavigate).toHaveBeenCalledWith("/board?taskId=42");
  });

  it("완료 승인 요청 바로가기는 팀장 페이지의 해당 승인 대기 업무로 이동한다", async () => {
    renderToast({ type: "COMPLETION_REQUESTED", targetType: "task", targetId: "42" });

    expect(screen.getByText("할 일")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "바로가기" }));

    expect(markNotificationsRead).toHaveBeenCalledWith(["1"]);
    expect(mockNavigate).toHaveBeenCalledWith("/leader/completion-approvals?taskId=42");
  });

  it("닫기(X) 버튼을 누르면 토스트만 닫고, 읽음 처리나 이동은 하지 않는다", async () => {
    renderToast({ type: "MEETING_SAVED_NOTIFY_LEADER", targetType: "meeting", targetId: "7" });

    await userEvent.click(screen.getByRole("button", { name: "알림 닫기" }));

    // 안 읽은 상태로 남아야 종 아이콘 목록에서 다시 확인할 수 있다.
    expect(markNotificationsRead).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("target이 없는 카드를 클릭하면 읽음 처리만 하고 이동하지 않는다", async () => {
    renderToast({ type: "TASK_ASSIGNED", targetType: null, targetId: null });

    await userEvent.click(screen.getByRole("alert"));

    expect(markNotificationsRead).toHaveBeenCalledWith(["1"]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("평가 공개 알림(evaluation)에도 바로가기 버튼이 보이고 클릭 시 마이페이지로 이동한다", async () => {
    renderToast({ type: "CONTRIBUTION_SCORE_PUBLISHED", targetType: "evaluation", targetId: "5" });

    await userEvent.click(screen.getByRole("button", { name: "바로가기" }));

    expect(markNotificationsRead).toHaveBeenCalledWith(["1"]);
    expect(mockNavigate).toHaveBeenCalledWith("/mypage");
  });
});
