import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DashProgressPage } from "./DashProgressPage";
import { updateMilestone, deleteMilestone } from "../../libs/utils/milestoneApi";
import type { MilestoneProgressDto, ProgressDetailResponse } from "../../libs/types/dashboard";

// jsdom은 Element.scrollTo를 구현하지 않아, 이 페이지의 가로 스크롤 차트 영역이
// 마운트될 때 TypeError가 발생한다.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

vi.mock("../../libs/utils/milestoneApi", () => ({
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
}));

vi.mock("../../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    currentProjectId: 1,
    currentProject: { role: "팀장" },
    user: { id: 1, name: "허영주" },
  }),
}));

vi.mock("../../../ai/components/AiInsightBox", () => ({
  AiInsightBox: () => <div data-testid="ai-insight-box" />,
}));

const refetchMock = vi.fn().mockResolvedValue(undefined);
let progressData: ProgressDetailResponse;

vi.mock("../../libs/hooks/useDashboardProgress", () => ({
  useDashboardProgress: () => ({
    data: progressData,
    loading: false,
    refreshing: false,
    error: null,
    refetch: refetchMock,
    runDelayRiskAnalysis: vi.fn(),
  }),
}));

vi.mock("../../libs/hooks/useDashboardTasks", () => ({
  useDashboardTasks: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/progress"]}>
      <DashProgressPage />
    </MemoryRouter>
  );
}

function makeMilestone(id: string, title: string): MilestoneProgressDto {
  return {
    id,
    title,
    startDate: "2026-07-01",
    dueDate: "2026-08-01",
    status: "todo",
    taskCount: 0,
    doneCount: 0,
    progressPercent: 0,
    createdAt: "2026-07-01",
    taskIds: [],
  };
}

describe("DashProgressPage 마일스톤 일괄 수정/삭제 부분 실패 처리", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refetchMock.mockResolvedValue(undefined);
    progressData = {
      totalTasks: 0,
      doneTasks: 0,
      progressPercent: 0,
      milestones: [makeMilestone("1", "MVP 발표"), makeMilestone("2", "중간 발표")],
      categoryBreakdown: [],
      delayRisks: [],
      hasPredictions: false,
      projectDeadline: "2026-08-15",
      projectCreatedAt: "2026-06-01",
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("일괄 수정 중 일부만 실패해도 성공분을 반영하도록 새로고침하고, 실패 개수를 안내하며 편집 모드를 유지해 재시도할 수 있게 한다", async () => {
    vi.mocked(updateMilestone)
      .mockResolvedValueOnce({} as MilestoneProgressDto)
      .mockRejectedValueOnce(new Error("서버 오류"));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "마일스톤 수정/삭제" }));

    const firstTitleInput = screen.getByDisplayValue("MVP 발표");
    const secondTitleInput = screen.getByDisplayValue("중간 발표");
    await userEvent.clear(firstTitleInput);
    await userEvent.type(firstTitleInput, "MVP 발표(수정)");
    await userEvent.clear(secondTitleInput);
    await userEvent.type(secondTitleInput, "중간 발표(수정)");

    await userEvent.click(screen.getByRole("button", { name: "수정" }));

    await waitFor(() => expect(refetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("2개 중 1개 수정에 실패했습니다. 다시 시도해주세요.")).toBeInTheDocument()
    );
    // 편집 모드가 유지되어 "취소"/"수정" 버튼이 그대로 남아 있어야 재시도할 수 있다.
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수정" })).toBeInTheDocument();
  });

  it("일괄 수정이 모두 성공하면 새로고침 후 편집 모드를 종료한다", async () => {
    vi.mocked(updateMilestone).mockResolvedValue({} as MilestoneProgressDto);

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "마일스톤 수정/삭제" }));
    const firstTitleInput = screen.getByDisplayValue("MVP 발표");
    await userEvent.clear(firstTitleInput);
    await userEvent.type(firstTitleInput, "MVP 발표(수정)");

    await userEvent.click(screen.getByRole("button", { name: "수정" }));

    await waitFor(() => expect(refetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument());
  });

  it("일괄 삭제 중 일부만 실패해도 성공분을 반영하도록 새로고침하고, 실패 개수를 안내하며 편집 모드를 유지해 재시도할 수 있게 한다", async () => {
    vi.mocked(deleteMilestone)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("서버 오류"));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "마일스톤 수정/삭제" }));

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1); // 첫 행은 헤더
    await userEvent.click(within(rows[0]).getAllByRole("button")[0]);
    await userEvent.click(within(rows[1]).getAllByRole("button")[0]);

    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(refetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("2개 중 1개 삭제에 실패했습니다. 다시 시도해주세요.")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
  });
});
