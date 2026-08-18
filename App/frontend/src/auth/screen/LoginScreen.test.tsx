import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";
import { apiFetch } from "../../global/api/apiClient";
import { tokenStore } from "../../global/api/tokenStore";

vi.mock("../../global/api/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../global/api/apiClient")>("../../global/api/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockRefreshMe = vi.hoisted(() => vi.fn());
const mockLoginWithGoogle = vi.hoisted(() => vi.fn());
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({ loginWithGoogle: mockLoginWithGoogle, refreshMe: mockRefreshMe }),
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const renderScreen = () => {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginScreen />
    </MemoryRouter>
  );
};

describe("LoginScreen", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockRefreshMe.mockReset();
    mockNavigate.mockReset();
    tokenStore.clear();
  });

  it("일반 사용자 로그인 성공 시 history를 대체하지 않고 /projects로 이동한다 (뒤로가기로 로그인 화면 복귀 가능)", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600, testSessionId: null,
      user: { id: 1, email: "leader@test", name: "허영주", affiliation: null, field: null, githubUsername: null, avatarUrl: null, isAdmin: false },
    });
    mockRefreshMe.mockResolvedValue({
      user: { id: 1, email: "leader@test", name: "허영주", affiliation: null, field: null, githubUsername: null, avatarUrl: null, isAdmin: false },
      projectRoles: [],
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginScreen />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText("이메일 입력"), "leader@test");
    await userEvent.type(screen.getByPlaceholderText("비밀번호 입력"), "pw-1234");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // replace: true로 이동하면 로그인 히스토리 엔트리가 사라져 로그인 직후 뒤로가기를 눌러도
    // 로그인 화면으로 못 돌아가고 다음 화면이 다시 뜬다 - 뒤로가기가 로그인 화면으로 돌아가야 하므로
    // 히스토리를 보존하는 일반 navigate여야 한다.
    expect(mockNavigate).toHaveBeenCalledWith("/projects");
  });

  it("비밀번호 찾기 링크가 /password-reset을 가리킨다", () => {
    renderScreen();

    expect(screen.getByRole("link", { name: "비밀번호 찾기" }))
      .toHaveAttribute("href", "/password-reset");
  });

  it("아이디 찾기 링크가 /find-email을 가리킨다", () => {
    renderScreen();

    expect(screen.getByRole("link", { name: "아이디 찾기" }))
      .toHaveAttribute("href", "/find-email");
  });
});
