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

const mockUsePresence = vi.fn().mockReturnValue([]);
vi.mock("../../hooks/usePresence", () => ({ usePresence: () => mockUsePresence() }));

describe("Header 접속자 아바타", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true, loading: false, user: { id: 1, email: "a@a.com", name: "테스트" },
      projectRoles: [], currentProjectId: 1, currentProject: null,
      selectProject: vi.fn(), addLocalProjectRole: vi.fn(), loginWithGoogle: vi.fn(),
      logout: vi.fn(), refreshMe: vi.fn(),
    });
    mockUseNotifications.mockReturnValue({ unreadCount: 0, refreshUnreadCount: vi.fn() });
  });

  it("프로필 사진이 있는 접속자는 이름 첫 글자 대신 사진을 보여준다", () => {
    mockUsePresence.mockReturnValue([
      { userId: 1, name: "허영주", role: "팀장", avatarUrl: "https://storage.example/avatars/1/a.png?sig=x" },
    ]);

    renderHeader();

    const avatar = screen.getByRole("img", { name: "허영주" });
    expect(avatar).toHaveAttribute("src", "https://storage.example/avatars/1/a.png?sig=x");
    expect(screen.getByTitle("허영주 / 팀장")).toBe(avatar);
  });

  it("프로필 사진이 없는 접속자는 이름 첫 글자 아바타로 대체한다", () => {
    mockUsePresence.mockReturnValue([
      { userId: 2, name: "박지수", role: "팀원", avatarUrl: null },
    ]);

    renderHeader();

    expect(screen.queryByRole("img", { name: "박지수" })).not.toBeInTheDocument();
    expect(screen.getByTitle("박지수 / 팀원")).toHaveTextContent("박");
  });
});

describe("Header 알림", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchNotifications).mockReset();
    vi.mocked(markNotificationsRead).mockReset();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true, loading: false, user: { id: 1, email: "a@a.com", name: "테스트" },
      projectRoles: [], currentProjectId: 1, currentProject: null,
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
      { id: "1", projectId: "1", type: "TASK_ASSIGNED", title: "제목", content: null, targetType: null, targetId: null, read: false, createdAt: new Date().toISOString() },
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
      { id: "1", projectId: "1", type: "TASK_ASSIGNED", title: "제목", content: null, targetType: null, targetId: null, read: false, createdAt: new Date().toISOString() },
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
      { id: "1", projectId: "1", type: "MEETING_SAVED_NOTIFY_LEADER", title: "회의록이 저장됐습니다", content: null, targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
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
      { id: "1", projectId: "1", type: "MEETING_EDITED", title: "회의록을 수정했습니다", content: null, targetType: "meeting", targetId: "9", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/meetings?meetingId=9");
  });

  it("업무 알림의 바로가기를 누르면 해당 업무 상세 딥링크로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      {
        id: "1", type: "TASK_ASSIGNED", title: "새 업무가 배정되었습니다.", content: null,
        targetType: "task", targetId: "42", projectId: "1", read: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();
    await userEvent.click(await screen.findByRole("button", { name: "바로가기" }));

    expect(mockNavigate).toHaveBeenCalledWith("/board?taskId=42");
  });

  it("완료 승인 요청 알림은 팀장 페이지의 해당 승인 대기 업무로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", projectId: "1", type: "COMPLETION_REQUESTED", title: "완료 승인 요청이 도착했습니다.", content: null, targetType: "task", targetId: "42", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    expect(screen.getByText("할 일")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "바로가기" }));

    expect(mockNavigate).toHaveBeenCalledWith("/leader/completion-approvals?taskId=42");
  });

  it("액션불필요 알림에는 바로가기 버튼이 없다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", projectId: "1", type: "MEETING_SAVED", title: "회의록이 저장됐습니다", content: null, targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    await screen.findByText("회의록이 저장됐습니다");
    expect(screen.queryByRole("button", { name: "바로가기" })).not.toBeInTheDocument();
  });

  it("평가 공개 알림(evaluation)에도 바로가기 버튼이 보이고 클릭 시 마이페이지로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", projectId: "1", type: "CONTRIBUTION_SCORE_PUBLISHED", title: "기여도 점수가 공개되었습니다.", content: "심사자가 '캡스톤디자인 2024' 프로젝트의 기여도 점수를 공개했습니다.", targetType: "evaluation", targetId: "5", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/mypage");
  });

  it("개인 코멘트 알림(personal_comment)에도 바로가기 버튼이 보이고 클릭 시 마이페이지의 해당 코멘트로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", projectId: "1", type: "PERSONAL_COMMENT", title: "새 코멘트가 도착했습니다", content: "UI가 깔끔하네요", targetType: "personal_comment", targetId: "9", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/mypage?commentId=9");
  });
  // 삭제 알림은 "할 일"도 아니고, 눌러도 열어볼 대상이 이미 없어 바로가기도 붙이지 않는다.
  // 분석 결과만 지운 경우 회의록 자체는 남지만 사용자가 확인하려던 분석 내용은 없으므로 마찬가지다.
  it("분석 결과 삭제 알림에는 바로가기도 할 일 배지도 없다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "MEETING_ANALYSIS_DELETED", projectId: "1", title: "회의록 분석 결과가 삭제되었습니다", content: "김민준님이 '정기회의' 회의록의 분석 결과를 삭제했습니다. (등록된 업무는 유지됨)", targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    await screen.findByText("회의록 분석 결과가 삭제되었습니다");
    expect(screen.queryByRole("button", { name: "바로가기" })).not.toBeInTheDocument();
    expect(screen.queryByText("할 일")).not.toBeInTheDocument();
  });

  it("회의록 삭제 알림에도 바로가기 버튼이 없다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "MEETING_DELETED", projectId: "1", title: "회의록이 삭제되었습니다", content: "김민준님이 '정기회의' 회의록을 삭제했습니다. (등록된 업무는 유지됨)", targetType: "meeting", targetId: "7", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    await screen.findByText("회의록이 삭제되었습니다");
    expect(screen.queryByRole("button", { name: "바로가기" })).not.toBeInTheDocument();
  });

  it("프로젝트를 전환하면 이전 프로젝트에서 불러온 알림 목록이 화면에서 사라진다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", projectId: "1", type: "TASK_ASSIGNED", title: "이전 프로젝트 알림", content: null, targetType: null, targetId: null, read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    const { rerender } = render(
      <MemoryRouter initialEntries={["/board"]}>
        <AuthProvider>
          <Header />
        </AuthProvider>
      </MemoryRouter>
    );
    await openBell();
    await screen.findByText("이전 프로젝트 알림");

    // 새 프로젝트로 전환됐지만, 아직 그 프로젝트의 목록을 다시 불러오기 전 상태를 재현한다.
    mockUseAuth.mockReturnValue({
      isAuthenticated: true, loading: false, user: { id: 1, email: "a@a.com", name: "테스트" },
      projectRoles: [], currentProjectId: 2, currentProject: null,
      selectProject: vi.fn(), addLocalProjectRole: vi.fn(), loginWithGoogle: vi.fn(),
      logout: vi.fn(), refreshMe: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/board"]}>
        <AuthProvider>
          <Header />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.queryByText("이전 프로젝트 알림")).not.toBeInTheDocument();
    expect(screen.getByText("알림이 없습니다.")).toBeInTheDocument();
  });
});
