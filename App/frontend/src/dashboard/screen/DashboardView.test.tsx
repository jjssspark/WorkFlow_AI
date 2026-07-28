import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "./DashboardView";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "김민준", email: "leader@test.com" },
    currentProjectId: 7,
    currentProject: { projectId: 7, projectTitle: "테스트 프로젝트", role: "팀장" },
  }),
}));

vi.mock("../libs/hooks/useDashboardSummary", () => ({
  useDashboardSummary: () => ({
    data: {
      totalTasks: 0,
      doneTasks: 0,
      progressPercent: 0,
      blockedTasks: 0,
      inProgressTasks: 0,
      upcomingDeadlines: [],
      workload: [],
      recentActivity: [],
    },
    loading: false,
    error: null,
  }),
}));

vi.mock("../libs/hooks/useDashboardProgress", () => ({
  useDashboardProgress: () => ({
    data: {
      totalTasks: 0,
      doneTasks: 0,
      progressPercent: 0,
      milestones: [],
      categoryBreakdown: [],
      delayRisks: [],
      hasPredictions: false,
      projectDeadline: null,
      projectCreatedAt: null,
    },
    loading: false,
    error: null,
  }),
}));

vi.mock("../libs/hooks/useDashboardTasks", () => ({
  useDashboardTasks: () => ({ data: [], loading: false }),
}));

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn().mockResolvedValue([
    { userId: 1, name: "김민준", email: "leader@test.com", role: "팀장" },
  ]),
}));

vi.mock("../../board/components/AddTaskModal", () => ({ AddTaskModal: () => null }));
vi.mock("../components/ProgressFrequencyChart", () => ({ ProgressFrequencyChart: () => null }));
vi.mock("../components/TaskDetailPopup", () => ({ TaskDetailPopup: () => null }));
vi.mock("../../meetings/components/MeetingUploadModal", () => ({
  MeetingUploadModal: ({ onUploaded }: { onUploaded: (meetingId: string, title: string, uploadedAt: string) => void }) => (
    <div>
      <span>대시보드 회의록 업로드 폼</span>
      <button onClick={() => onUploaded("meeting-7", "7차 정기회의", "2026-07-28T02:00:00.000Z")}>업로드 완료 처리</button>
    </div>
  ),
}));

describe("DashboardView 회의록 업로드 빠른 액션", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it("버튼 클릭만으로 페이지를 이동하지 않고, 업로드 접수 완료 후에만 회의록 분석 화면으로 이동한다", async () => {
    const user = userEvent.setup();
    render(<DashboardView />);

    await user.click(screen.getByRole("button", { name: "회의록 업로드" }));

    expect(screen.getByText("대시보드 회의록 업로드 폼")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "업로드 완료 처리" }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      "/meetings?resume=meeting-7&title=7%EC%B0%A8%20%EC%A0%95%EA%B8%B0%ED%9A%8C%EC%9D%98&uploadedAt=2026-07-28T02%3A00%3A00.000Z"
    );
  });
});
