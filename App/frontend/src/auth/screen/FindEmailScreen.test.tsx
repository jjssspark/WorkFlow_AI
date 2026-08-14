import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { FindEmailScreen } from "./FindEmailScreen";
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
      <FindEmailScreen />
    </MemoryRouter>,
  );

describe("FindEmailScreen", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("조회 결과의 마스킹된 이메일을 보여준다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ maskedEmails: ["ki****@gmail.com"] });
    renderScreen();

    await userEvent.type(screen.getByLabelText("이름"), "홍길동");
    await userEvent.type(screen.getByLabelText("소속"), "컴퓨터공학과");
    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    await waitFor(() => {
      expect(screen.getByText("ki****@gmail.com")).toBeInTheDocument();
    });
  });

  it("결과가 없으면 안내 문구를 보여준다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ maskedEmails: [] });
    renderScreen();

    await userEvent.type(screen.getByLabelText("이름"), "없는사람");
    await userEvent.type(screen.getByLabelText("소속"), "없는소속");
    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    await waitFor(() => {
      expect(
        screen.getByText("일치하는 계정을 찾지 못했습니다. 입력한 정보를 다시 확인해주세요."),
      ).toBeInTheDocument();
    });
    // 결과 없음은 에러가 아니다 — 안내 문구가 alert 역할(에러 박스)로 렌더링되면 안 된다.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("이름과 소속이 모두 비면 요청을 보내지 않는다", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("소속이 비면 요청을 보내지 않는다", async () => {
    renderScreen();

    await userEvent.type(screen.getByLabelText("이름"), "홍길동");
    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("이름이 비면 요청을 보내지 않는다", async () => {
    renderScreen();

    await userEvent.type(screen.getByLabelText("소속"), "컴퓨터공학과");
    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("서버가 에러 메시지로 계정 존재 여부를 흘려도 화면에는 고정 문구만 보여준다", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiRequestError("해당 이름과 소속의 계정이 3건 있습니다", 400, "ACCOUNT_FOUND"),
    );
    renderScreen();

    await userEvent.type(screen.getByLabelText("이름"), "홍길동");
    await userEvent.type(screen.getByLabelText("소속"), "컴퓨터공학과");
    await userEvent.click(screen.getByRole("button", { name: "아이디 찾기" }));

    await waitFor(() => {
      expect(
        screen.getByText("조회에 실패했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("해당 이름과 소속의 계정이 3건 있습니다"),
    ).not.toBeInTheDocument();
  });
});
