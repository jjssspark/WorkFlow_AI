import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteCodeSection } from "./InviteCodeSection";

const mockGetProject = vi.hoisted(() => vi.fn());
const mockCreateInvitationLink = vi.hoisted(() => vi.fn());
vi.mock("../../api/projectsApi", () => ({
  getProject: mockGetProject,
  createInvitationLink: mockCreateInvitationLink,
}));

const writeText = vi.fn();

beforeEach(() => {
  mockGetProject.mockReset();
  mockCreateInvitationLink.mockReset();
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("InviteCodeSection", () => {
  it("초대 코드를 화면에 노출하지 않는다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });

    render(<InviteCodeSection projectId={1} />);

    expect(await screen.findByRole("button", { name: "코드 복사" })).toBeInTheDocument();
    expect(screen.queryByText("GX4MKP")).not.toBeInTheDocument();
  });

  it("코드 복사 버튼을 누르면 클립보드에 원본 코드를 넣고 코드를 복사했다고 안내한다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "코드 복사" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GX4MKP"));
    expect(await screen.findByText("코드를 복사했습니다")).toBeInTheDocument();
  });

  it("링크 복사 버튼을 누르면 서버에서 발급한 초대 토큰으로 URL을 만들어 클립보드에 넣는다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });
    mockCreateInvitationLink.mockResolvedValue({
      projectId: 1,
      email: null,
      role: "팀원",
      token: "LINK-TOKEN-ABC",
      status: "pending",
      expiresAt: "2026-08-04T00:00:00",
    });

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));

    expect(mockCreateInvitationLink).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/LINK-TOKEN-ABC`),
    );
    expect(await screen.findByText("링크를 복사했습니다")).toBeInTheDocument();
  });

  it("코드 복사 성공 후 링크 복사가 실패하면 실패 메시지 한 줄만 보여준다(성공 메시지와 같이 뜨지 않는다)", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });
    mockCreateInvitationLink.mockRejectedValue(new Error("서버 오류"));

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    expect(await screen.findByText("코드를 복사했습니다")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));

    expect(await screen.findByText("복사하지 못했습니다. 다시 시도해주세요")).toBeInTheDocument();
    expect(screen.queryByText("코드를 복사했습니다")).not.toBeInTheDocument();
  });

  it("링크 복사 버튼을 다시 누르면 서버에 다시 물어봐 최신 토큰을 반영한다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });
    mockCreateInvitationLink
      .mockResolvedValueOnce({ projectId: 1, email: null, role: "팀원", token: "FIRST", status: "pending", expiresAt: "2026-08-04T00:00:00" })
      .mockResolvedValueOnce({ projectId: 1, email: null, role: "팀원", token: "SECOND", status: "pending", expiresAt: "2026-08-11T00:00:00" });

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/FIRST`));

    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/SECOND`));
    expect(mockCreateInvitationLink).toHaveBeenCalledTimes(2);
  });

  it("링크 발급이 실패하면 실패 안내를 보여준다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });
    mockCreateInvitationLink.mockRejectedValue(new Error("서버 오류"));

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));

    expect(await screen.findByText("복사하지 못했습니다. 다시 시도해주세요")).toBeInTheDocument();
  });

  it("클립보드 복사가 실패하면 실패 안내를 보여준다", async () => {
    mockGetProject.mockResolvedValue({ id: 1, inviteCode: "GX4MKP" });
    writeText.mockRejectedValue(new Error("권한 거부"));

    render(<InviteCodeSection projectId={1} />);
    await screen.findByRole("button", { name: "코드 복사" });
    await userEvent.click(screen.getByRole("button", { name: "코드 복사" }));

    expect(
      await screen.findByText("복사하지 못했습니다. 다시 시도해주세요"),
    ).toBeInTheDocument();
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
