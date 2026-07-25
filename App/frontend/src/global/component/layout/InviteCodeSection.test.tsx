import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteCodeSection } from "./InviteCodeSection";

const mockGetProject = vi.hoisted(() => vi.fn());
vi.mock("../../api/projectsApi", () => ({ getProject: mockGetProject }));

const writeText = vi.fn();

beforeEach(() => {
  mockGetProject.mockReset();
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("InviteCodeSection", () => {
  it("초대 코드를 불러와 화면에 보여준다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });

    render(<InviteCodeSection projectId={1} />);

    expect(await screen.findByText("GX4MKP")).toBeInTheDocument();
    expect(mockGetProject).toHaveBeenCalledWith(1);
  });

  it("코드 복사 버튼을 누르면 클립보드에 코드를 넣는다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });

    render(<InviteCodeSection projectId={1} />);
    await screen.findByText("GX4MKP");
    await userEvent.click(screen.getByRole("button", { name: "코드 복사" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GX4MKP"));
  });

  it("초대 코드가 없으면 안내 문구를 보여준다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: null });

    render(<InviteCodeSection projectId={1} />);

    expect(await screen.findByText("초대 코드를 불러오지 못했습니다")).toBeInTheDocument();
  });

  it("조회가 실패해도 크래시하지 않고 안내 문구를 보여준다", async () => {
    mockGetProject.mockRejectedValue(new Error("network"));

    render(<InviteCodeSection projectId={1} />);

    expect(await screen.findByText("초대 코드를 불러오지 못했습니다")).toBeInTheDocument();
  });
});
