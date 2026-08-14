import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { PasswordResetRequestScreen } from "./PasswordResetRequestScreen";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";

vi.mock("../../global/api/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../global/api/apiClient")>(
    "../../global/api/apiClient",
  );
  return { ...actual, apiFetch: vi.fn() };
});

const renderScreen = () =>
  render(
    <MemoryRouter>
      <PasswordResetRequestScreen />
    </MemoryRouter>,
  );

describe("PasswordResetRequestScreen", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("요청에 성공하면 고정 안내 문구를 보여준다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(null);
    renderScreen();

    await userEvent.type(screen.getByLabelText("이메일"), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: "재설정 메일 받기" }));

    await waitFor(() => {
      expect(
        screen.getByText("가입된 계정이면 비밀번호 재설정 메일을 보냈습니다."),
      ).toBeInTheDocument();
    });
  });

  it("이메일이 비면 요청을 보내지 않는다", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "재설정 메일 받기" }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("서버가 에러 메시지로 계정 존재 여부를 흘려도 화면에는 고정 문구만 보여준다", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiRequestError("이 계정은 존재하지 않습니다", 400, "ACCOUNT_NOT_FOUND"),
    );
    renderScreen();

    await userEvent.type(screen.getByLabelText("이메일"), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: "재설정 메일 받기" }));

    await waitFor(() => {
      expect(
        screen.getByText("요청에 실패했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("이 계정은 존재하지 않습니다")).not.toBeInTheDocument();
  });
});
