import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../hooks/useAuth";
import { Header } from "./Header";
import { fetchNotifications, markNotificationsRead } from "../../api/notificationApi";

vi.mock("../ui/use-mobile", () => ({ useIsMobile: () => true }));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderHeader(onOpenMobileMenu = vi.fn(), initialPath = "/board") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Header onOpenMobileMenu={onOpenMobileMenu} />
      </AuthProvider>
    </MemoryRouter>
  );
  return onOpenMobileMenu;
}

describe("Header (mobile)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a hamburger button on mobile and calls onOpenMobileMenu when clicked", async () => {
    const onOpenMobileMenu = renderHeader();
    const button = screen.getByRole("button", { name: "메뉴 열기" });
    await userEvent.click(button);
    expect(onOpenMobileMenu).toHaveBeenCalledOnce();
  });

  it.each([
    ["/leader/roadmap", "로드맵"],
    ["/leader/completion-approvals", "완료승인 대기"],
  ])("shows the leader subpage in the top breadcrumb for %s", (path, childTitle) => {
    renderHeader(vi.fn(), path);

    expect(screen.getByRole("button", { name: "팀장페이지" })).toBeInTheDocument();
    expect(screen.getByText(childTitle)).toBeInTheDocument();
  });

  it("keeps the global header and notification popover above sticky page content", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);
    renderHeader();

    expect(document.querySelector("[data-global-header]")).toHaveClass("z-40");
    await userEvent.click(screen.getByRole("button", { name: "알림" }));

    expect(document.querySelector("[data-notification-popover]")).toHaveClass("z-50");
    expect(document.querySelector("[data-notification-list]")).toHaveClass(
      "max-h-[calc(100vh-10rem)]",
      "overflow-y-auto",
    );
  });
});

vi.mock("../../api/notificationApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/notificationApi")>();
  return {
    ...actual,
    fetchNotifications: vi.fn(),
    markNotificationsRead: vi.fn(),
  };
});

// 첫 번째 describe("Header (mobile)")는 실제 AuthProvider(비로그인 상태)로도 문제없이 렌더링돼야
// 하므로, 이 모킹이 파일 전체에 적용되더라도 깨지지 않도록 기본값을 비로그인 상태로 둔다.
const mockUseAuth = vi.fn().mockReturnValue({
  isAuthenticated: false, loading: false, user: null, projectRoles: [], currentProjectId: null, currentProject: null,
  selectProject: vi.fn(), addLocalProjectRole: vi.fn(), loginWithGoogle: vi.fn(), logout: vi.fn(), refreshMe: vi.fn(),
});
vi.mock("../../hooks/useAuth", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useAuth")>("../../hooks/useAuth");
  return { ...actual, useAuth: () => mockUseAuth() };
});

const mockUseNotifications = vi.fn().mockReturnValue({ unreadCount: 0, refreshUnreadCount: vi.fn() });
vi.mock("../../hooks/useNotifications", () => ({ useNotifications: () => mockUseNotifications() }));

describe("Header 알림", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchNotifications).mockReset();
    vi.mocked(markNotificationsRead).mockReset();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true, loading: false, user: { id: 1, email: "a@a.com", name: "테스트" },
      projectRoles: [], currentProjectId: null, currentProject: null,
      selectProject: vi.fn(), addLocalProjectRole: vi.fn(), loginWithGoogle: vi.fn(),
      logout: vi.fn(), refreshMe: vi.fn(),
    });
    mockUseNotifications.mockReturnValue({ unreadCount: 0, refreshUnreadCount: vi.fn() });
  });

  async function openBell() {
    await userEvent.click(screen.getByRole("button", { name: "알림" }));
  }

  it("목록을 다 불러온 뒤에만, 그 목록에 있던 id만 읽음 처리를 요청한다(동시 요청 금지)", async () => {
    let resolveFetch: (value: Awaited<ReturnType<typeof fetchNotifications>>) => void;
    vi.mocked(fetchNotifications).mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    // fetchNotifications가 아직 응답하지 않은 상태에서는 읽음 처리가 호출되면 안 된다.
    expect(markNotificationsRead).not.toHaveBeenCalled();

    resolveFetch!([
      { id: "1", type: "TASK_ASSIGNED", title: "제목", content: null, targetType: null, targetId: null, read: false, createdAt: new Date().toISOString() },
    ]);
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(["1"]));
  });

  it("목록 조회에 실패하면 읽음 처리를 시도하지 않고 에러를 보여준다", async () => {
    vi.mocked(fetchNotifications).mockRejectedValue(new Error("network error"));

    renderHeader();
    await openBell();

    await screen.findByText("알림을 불러오지 못했습니다. 다시 시도해주세요.");
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it("읽음 처리에 실패하면 refreshUnreadCount를 호출하지 않아 배지 숫자가 그대로 유지된다", async () => {
    const refreshUnreadCount = vi.fn();
    mockUseNotifications.mockReturnValue({ unreadCount: 3, refreshUnreadCount });
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "TASK_ASSIGNED", title: "제목", content: null, targetType: null, targetId: null, read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockRejectedValue(new Error("network error"));

    renderHeader();
    expect(screen.getByRole("button", { name: "알림" }).textContent).toContain("3");

    await openBell();
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(["1"]));
    expect(refreshUnreadCount).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "알림" }).textContent).toContain("3");
  });

  it("액션필요 알림에는 바로가기 버튼이 보이고 클릭 시 meetingId로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "MEETING_SAVED_NOTIFY_LEADER", title: "회의록이 저장됐습니다", content: null, targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/meetings?meetingId=7");
  });

  it("수정 알림(MEETING_EDITED)에도 바로가기 버튼이 보이고 클릭 시 meetingId로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "MEETING_EDITED", title: "회의록을 수정했습니다", content: null, targetType: "meeting", targetId: "9", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/meetings?meetingId=9");
  });

  it("액션불필요 알림에는 바로가기 버튼이 없다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "MEETING_SAVED", title: "회의록이 저장됐습니다", content: null, targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    await screen.findByText("회의록이 저장됐습니다");
    expect(screen.queryByRole("button", { name: "바로가기" })).not.toBeInTheDocument();
  });
});
