import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordChangeSection } from "./PasswordChangeSection";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";
import { tokenStore } from "../../global/api/tokenStore";

vi.mock("../../global/api/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../global/api/apiClient")>(
    "../../global/api/apiClient",
  );
  return { ...actual, apiFetch: vi.fn() };
});

const CURRENT = "current-pw-1234";
const NEXT = "new-password-1234";

const fill = async (current: string, next: string, confirm: string) => {
  await userEvent.type(screen.getByLabelText("현재 비밀번호"), current);
  await userEvent.type(screen.getByLabelText("새 비밀번호"), next);
  await userEvent.type(screen.getByLabelText("새 비밀번호 확인"), confirm);
};

const submit = () => userEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

describe("PasswordChangeSection", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    tokenStore.setTokens("old-access", "old-refresh");
  });

  it("두 입력이 일치하지 않으면 요청을 보내지 않는다", async () => {
    render(<PasswordChangeSection />);

    await fill(CURRENT, NEXT, "something-else-1234");
    await submit();

    expect(screen.getByText("두 비밀번호가 일치하지 않습니다.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("새 비밀번호가 8자 미만이면 서버에 묻지 않고 막는다", async () => {
    render(<PasswordChangeSection />);

    await fill(CURRENT, "1234567", "1234567");
    await submit();

    expect(screen.getByText("비밀번호는 8자 이상 128자 이하로 입력해주세요.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("새 비밀번호가 현재와 같으면 왕복 없이 막는다", async () => {
    render(<PasswordChangeSection />);

    await fill(CURRENT, CURRENT, CURRENT);
    await submit();

    expect(screen.getByText("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("성공하면 응답으로 받은 새 토큰으로 갈아끼운다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresIn: 1800,
      user: null,
    });
    render(<PasswordChangeSection />);

    await fill(CURRENT, NEXT, NEXT);
    await submit();

    await waitFor(() => {
      expect(tokenStore.getAccessToken()).toBe("fresh-access");
    });
    // 토큰을 갈아끼우지 않으면 액세스 토큰 만료 직후 본인이 튕긴다.
    expect(tokenStore.getRefreshToken()).toBe("fresh-refresh");
    expect(screen.getByText("비밀번호가 변경되었습니다.")).toBeInTheDocument();
  });

  it("PUT /me/password로 입력값을 그대로 보낸다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 1800,
      user: null,
    });
    render(<PasswordChangeSection />);

    await fill(CURRENT, NEXT, NEXT);
    await submit();

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe("/me/password");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
  });

  it("성공 후 다시 입력하기 시작하면 성공 배너를 치운다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 1800,
      user: null,
    });
    render(<PasswordChangeSection />);

    await fill(CURRENT, NEXT, NEXT);
    await submit();
    expect(await screen.findByText("비밀번호가 변경되었습니다.")).toBeInTheDocument();

    // 이전 시도의 성공 문구가 다음 시도 위에 남아 있으면 무엇이 성공했다는 건지 알 수 없다.
    await userEvent.type(screen.getByLabelText("현재 비밀번호"), "x");

    expect(screen.queryByText("비밀번호가 변경되었습니다.")).not.toBeInTheDocument();
  });

  it("현재 비밀번호가 틀리면 서버 문구를 보여주고 토큰은 건드리지 않는다", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiRequestError("현재 비밀번호가 올바르지 않습니다.", 400, "INVALID_CREDENTIALS"),
    );
    render(<PasswordChangeSection />);

    await fill("wrong-password", NEXT, NEXT);
    await submit();

    expect(await screen.findByText("현재 비밀번호가 올바르지 않습니다.")).toBeInTheDocument();
    expect(tokenStore.getAccessToken()).toBe("old-access");
  });

  it("성공하면 입력값을 비워 화면에 비밀번호가 남지 않게 한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 1800,
      user: null,
    });
    render(<PasswordChangeSection />);

    await fill(CURRENT, NEXT, NEXT);
    await submit();

    await waitFor(() => {
      expect(screen.getByLabelText("현재 비밀번호")).toHaveValue("");
    });
    expect(screen.getByLabelText("새 비밀번호")).toHaveValue("");
    expect(screen.getByLabelText("새 비밀번호 확인")).toHaveValue("");
  });
});
