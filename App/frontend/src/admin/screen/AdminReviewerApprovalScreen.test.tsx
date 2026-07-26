import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewerApprovalScreen } from "./AdminReviewerApprovalScreen";

const mockList = vi.hoisted(() => vi.fn());
const mockApprove = vi.hoisted(() => vi.fn());
const mockReject = vi.hoisted(() => vi.fn());
vi.mock("../../global/api/adminApi", () => ({
  listReviewerApplications: mockList,
  approveReviewerApplication: mockApprove,
  rejectReviewerApplication: mockReject,
}));

const PENDING_APPLICATION = {
  userId: 1,
  name: "고교수",
  email: "prof@example.com",
  affiliation: "컴퓨터공학과",
  facultyId: "PROF-2026-001",
  status: "PENDING" as const,
  createdAt: "2026-07-26T00:00:00",
  rejectionReason: null,
};

beforeEach(() => {
  mockList.mockReset();
  mockApprove.mockReset();
  mockReject.mockReset();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <AdminReviewerApprovalScreen />
    </MemoryRouter>
  );
}

describe("AdminReviewerApprovalScreen", () => {
  it("승인 대기 목록을 불러와 보여준다", async () => {
    mockList.mockResolvedValue({ items: [PENDING_APPLICATION], page: 0, size: 20, totalElements: 1, totalPages: 1 });

    renderScreen();

    expect(await screen.findByText("고교수")).toBeInTheDocument();
    expect(screen.getByText("컴퓨터공학과")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith("PENDING", 0, 20);
  });

  it("승인 버튼을 누르면 approve API를 호출하고 목록을 새로고침한다", async () => {
    mockList.mockResolvedValue({ items: [PENDING_APPLICATION], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    mockApprove.mockResolvedValue(undefined);
    renderScreen();
    await screen.findByText("고교수");

    await userEvent.click(screen.getByRole("button", { name: "승인" }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(1));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("거부 버튼을 누르면 사유 입력 후 reject API를 호출한다", async () => {
    mockList.mockResolvedValue({ items: [PENDING_APPLICATION], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    mockReject.mockResolvedValue(undefined);
    renderScreen();
    await screen.findByText("고교수");

    await userEvent.click(screen.getByRole("button", { name: "거부" }));
    await userEvent.type(screen.getByPlaceholderText("거부 사유를 입력하세요"), "서류 미비");
    await userEvent.click(screen.getByRole("button", { name: "거부 확정" }));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith(1, "서류 미비"));
  });

  it("목록이 비어있으면 안내 문구를 보여준다", async () => {
    mockList.mockResolvedValue({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });

    renderScreen();

    expect(await screen.findByText("승인 대기 중인 심사자 신청이 없습니다.")).toBeInTheDocument();
  });
});
