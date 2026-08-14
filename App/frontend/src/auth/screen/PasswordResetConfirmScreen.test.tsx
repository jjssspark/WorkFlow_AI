import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { PasswordResetConfirmScreen } from "./PasswordResetConfirmScreen";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";

vi.mock("../../global/api/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../global/api/apiClient")>(
    "../../global/api/apiClient",
  );
  return { ...actual, apiFetch: vi.fn() };
});

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <PasswordResetConfirmScreen />
    </MemoryRouter>,
  );

describe("PasswordResetConfirmScreen", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("토큰이 없으면 폼 대신 안내를 보여준다", () => {
    renderAt("");

    expect(
      screen.getByText("재설정 링크가 올바르지 않습니다. 다시 요청해 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("새 비밀번호")).not.toBeInTheDocument();
  });

  it("두 입력이 다르면 요청을 보내지 않는다", async () => {
    renderAt("?token=abc");

    await userEvent.type(screen.getByLabelText("새 비밀번호"), "newPassword123");
    await userEvent.type(screen.getByLabelText("새 비밀번호 확인"), "different123");
    await userEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    expect(screen.getByText("두 비밀번호가 일치하지 않습니다.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("8자 미만이면 요청을 보내지 않는다", async () => {
    renderAt("?token=abc");

    await userEvent.type(screen.getByLabelText("새 비밀번호"), "short");
    await userEvent.type(screen.getByLabelText("새 비밀번호 확인"), "short");
    await userEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    expect(screen.getByText("비밀번호는 8자 이상 128자 이하로 입력해주세요.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("성공하면 완료 문구를 보여준다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(null);
    renderAt("?token=abc");

    await userEvent.type(screen.getByLabelText("새 비밀번호"), "newPassword123");
    await userEvent.type(screen.getByLabelText("새 비밀번호 확인"), "newPassword123");
    await userEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    await waitFor(() => {
      expect(screen.getByText("비밀번호가 변경되었습니다.")).toBeInTheDocument();
    });
  });

  it("만료된 토큰이면 서버 메시지를 보여준다", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiRequestError("재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.", 400, "INVALID_RESET_TOKEN"),
    );
    renderAt("?token=expired");

    await userEvent.type(screen.getByLabelText("새 비밀번호"), "newPassword123");
    await userEvent.type(screen.getByLabelText("새 비밀번호 확인"), "newPassword123");
    await userEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    await waitFor(() => {
      expect(
        screen.getByText("재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요."),
      ).toBeInTheDocument();
    });
  });
});
