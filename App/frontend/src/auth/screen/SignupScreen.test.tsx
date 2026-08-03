import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupScreen, SIGNUP_DRAFT_KEY } from "./SignupScreen";

vi.mock("../../global/api/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../global/api/apiClient")>("../../global/api/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({ loginWithGoogle: vi.fn(), refreshMe: vi.fn() }),
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <SignupScreen />
    </MemoryRouter>
  );
}

describe("SignupScreen 약관 동의", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
  });

  // 약관을 별도 라우트(/terms)로 띄우면 이 화면이 언마운트돼 비밀번호가 사라졌다.
  // 비밀번호는 sessionStorage에 저장하지 않으므로 복원할 방법도 없다 - 그래서 모달로 띄운다.
  it("이용약관을 열고 동의해도 입력한 비밀번호가 유지된다", async () => {
    renderSignup();

    await userEvent.type(screen.getByPlaceholderText("8자 이상 입력"), "pw-1234!");
    await userEvent.type(screen.getByPlaceholderText("비밀번호를 다시 입력"), "pw-1234!");

    await userEvent.click(screen.getByRole("button", { name: "이용약관 보기" }));
    await userEvent.click(await screen.findByRole("button", { name: "동의합니다" }));

    expect(screen.getByPlaceholderText("8자 이상 입력")).toHaveValue("pw-1234!");
    expect(screen.getByPlaceholderText("비밀번호를 다시 입력")).toHaveValue("pw-1234!");
    expect(screen.getByRole("button", { name: "이용약관 동의 해제" })).toBeInTheDocument();
  });

  it("이용약관을 열어도 다른 화면으로 이동하지 않는다", async () => {
    renderSignup();

    await userEvent.click(screen.getByRole("button", { name: "이용약관 보기" }));

    expect(await screen.findByRole("heading", { name: "이용약관" })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("개인정보처리방침도 같은 방식으로 비밀번호를 유지한다", async () => {
    renderSignup();

    await userEvent.type(screen.getByPlaceholderText("8자 이상 입력"), "pw-1234!");

    await userEvent.click(screen.getByRole("button", { name: "개인정보처리방침 보기" }));
    await userEvent.click(await screen.findByRole("button", { name: "동의합니다" }));

    expect(screen.getByPlaceholderText("8자 이상 입력")).toHaveValue("pw-1234!");
    expect(screen.getByRole("button", { name: "개인정보처리방침 동의 해제" })).toBeInTheDocument();
  });
});
