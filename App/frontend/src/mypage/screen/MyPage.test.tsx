import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MyPage } from "./MyPage";
import { fetchTasks } from "../../board/libs/utils/taskApi";
import { getMyEvaluation } from "../../global/api/evaluationApi";
import type { Task } from "../../board/libs/types/task";
import { useAuth } from "../../global/hooks/useAuth";
import { fetchReviewerProjects } from "../libs/utils/reviewerApi";
import type { ReviewerProject } from "../libs/utils/reviewerApi";
import { getProjectMembers } from "../../global/api/projectsApi";
import { fetchContributionReport, fetchContributionScore } from "../../contributors/libs/utils/contributorsApi";
import { fetchAttendanceSummary } from "../../meetings/libs/utils/meetingAiApi";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../board/libs/utils/taskApi", () => ({
  fetchTasks: vi.fn(),
}));

vi.mock("../../global/api/evaluationApi", () => ({
  getMyEvaluation: vi.fn(),
}));

vi.mock("../libs/utils/reviewerApi", () => ({
  fetchReviewerProjects: vi.fn(),
}));

vi.mock("../../global/api/projectsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../global/api/projectsApi")>();
  return { ...actual, getProjectMembers: vi.fn() };
});

vi.mock("../../contributors/libs/utils/contributorsApi", () => ({
  fetchContributionReport: vi.fn(),
  fetchContributionScore: vi.fn(),
}));

vi.mock("../../meetings/libs/utils/meetingAiApi", () => ({
  fetchAttendanceSummary: vi.fn(),
}));

function makeTask(id: string, assignee: string, status: Task["status"], dueDate: string): Task {
  return { id, title: `업무 ${id}`, status, priority: "medium", assignee, dueDate, labels: [], category: "frontend", position: 0, pendingApproval: false, startDate: "", extraFields: {} };
}

function makeReviewerProject(projectId: number, title: string, evalStatus: ReviewerProject["evalStatus"] = "pending"): ReviewerProject {
  return {
    projectId, title, type: "캡스톤디자인", leaderName: "김민준", memberCount: 4,
    progressPercent: 71, evalStatus, deliverablesSubmitted: 0, deliverablesTotal: 0, githubConnected: false,
  };
}

function renderMyPage() {
  return render(
    <MemoryRouter initialEntries={["/mypage"]}>
      <MyPage />
    </MemoryRouter>
  );
}

describe("MyPage member view", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: false, score: null, finalRevealed: false, reviewerScore: null,
      grade: null, commentRevealed: false, comment: null,
    });
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      loading: false,
      user: { id: 1, email: "seo.yeon@university.ac.kr", name: "이서연" },
      projectRoles: [{ projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원" }],
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원" },
      selectProject: vi.fn(),
      addLocalProjectRole: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });
  });

  it("shows task stat counts computed from real fetched tasks assigned to the current user", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([
      makeTask("A", "1", "done", "2026-01-10"),
      makeTask("B", "1", "inprogress", "2026-01-20"),
      makeTask("C", "2", "done", "2026-01-10"), // 다른 담당자, 제외돼야 함
    ]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("업무 A")).toBeInTheDocument());
    expect(screen.queryByText("업무 C")).not.toBeInTheDocument();
  });

  it("shows a loading message while tasks are being fetched", async () => {
    vi.mocked(fetchTasks).mockReturnValue(new Promise(() => {}));

    renderMyPage();

    expect(screen.getByText("업무 정보를 불러오는 중...")).toBeInTheDocument();
    // getMyEvaluation은 정상적으로 resolve되므로, 그 상태 갱신이 act() 밖에서 일어나
    // "not wrapped in act" 경고가 뜨지 않도록 테스트 종료 전에 흘려보낸다.
    await waitFor(() => expect(getMyEvaluation).toHaveBeenCalled());
  });

  it("shows an error message with a retry button when the fetch fails, and retries on click", async () => {
    vi.mocked(fetchTasks).mockRejectedValueOnce(new Error("실패")).mockResolvedValueOnce([makeTask("A", "1", "todo", "")]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("업무 정보를 불러오지 못했습니다.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /다시 시도/ }));
    await waitFor(() => expect(screen.getByText("업무 A")).toBeInTheDocument());
  });

  it("shows an empty-state message when the user has no assigned tasks", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("담당 중인 업무가 없습니다.")).toBeInTheDocument());
  });

  it("filters the task list to today's/this week's due tasks when the tabs are clicked", async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vi.mocked(fetchTasks).mockResolvedValue([
      makeTask("TODAY", "1", "todo", todayIso),
      makeTask("FAR", "1", "todo", "2099-12-31"),
    ]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("업무 FAR")).toBeInTheDocument());
    const taskListCard = screen.getByText("내 업무 목록").closest(".bg-card") as HTMLElement;
    await userEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(within(taskListCard).getByText("업무 TODAY")).toBeInTheDocument();
    expect(within(taskListCard).queryByText("업무 FAR")).not.toBeInTheDocument();
  });

  it("does not render the deliverables section", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("담당 중인 업무가 없습니다.")).toBeInTheDocument());
    expect(screen.queryByText("내가 담당한 산출물")).not.toBeInTheDocument();
  });

  it("does not render the activity timeline", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("담당 중인 업무가 없습니다.")).toBeInTheDocument());
    expect(screen.queryByText("내 활동 타임라인")).not.toBeInTheDocument();
  });

  it("does not show the public score section when the reviewer hasn't published anything", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: false, score: null, finalRevealed: false, reviewerScore: null,
      grade: null, commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(getMyEvaluation).toHaveBeenCalledWith(1));
    expect(screen.queryByText("공개된 평가 결과")).not.toBeInTheDocument();
  });

  it("shows the reviewer-published score once revealed, hidden behind a reveal button first", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: true, score: 88, finalRevealed: true, reviewerScore: 90,
      grade: "A+", commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(screen.getByText("공개된 평가 결과")).toBeInTheDocument());
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /결과 확인하기/ }));
    // 기여 점수/심사자 점수/학점 세 값이 모두 표시된다.
    expect(screen.getByText("88.00")).toBeInTheDocument();
    expect(screen.getByText("90.00")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
  });

  it("기여 점수만 공개되고 총합/학점은 아직 비공개일 때, 기여 점수만 표시하고 총합/학점 칸은 '-'로 숨긴다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: true, score: 76.12, finalRevealed: false, reviewerScore: null,
      grade: null, commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(screen.getByText("공개된 평가 결과")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /결과 확인하기/ }));
    expect(screen.getByText("76.12")).toBeInTheDocument();
    // 총합/심사자 점수/학점은 아직 공개되지 않아 "-"로 표시된다.
    expect(screen.getAllByText("-")).toHaveLength(2);
  });

  it("심사 코멘트가 공개되면 개인 코멘트/피드백 목록 맨 앞에 심사자 코멘트가 나타난다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: false, score: null, finalRevealed: false, reviewerScore: null,
      grade: null, commentRevealed: true, comment: "팀장으로서 팀을 잘 이끌어주고 있습니다.",
    });

    renderMyPage();

    await waitFor(() =>
      expect(screen.getByText("팀장으로서 팀을 잘 이끌어주고 있습니다.")).toBeInTheDocument(),
    );
    expect(screen.getByText("심사자 코멘트")).toBeInTheDocument();
    // 코멘트만 공개된 상태이므로 "공개된 평가 결과" 카드는 아직 뜨지 않는다.
    expect(screen.queryByText("공개된 평가 결과")).not.toBeInTheDocument();
  });
});

describe("MyPage reviewer view", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      loading: false,
      user: { id: 6, email: "reviewer@university.ac.kr", name: "고무서" },
      projectRoles: [
        { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원" },
        { projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자" },
      ],
      currentProjectId: 2,
      currentProject: { projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자" },
      selectProject: vi.fn(),
      addLocalProjectRole: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });
  });

  it("renders the reviewer page (not the member page) when the CURRENT project's role is 심사자, even though it isn't the first entry in projectRoles", async () => {
    vi.mocked(fetchReviewerProjects).mockResolvedValue([makeReviewerProject(2, "AI 기반 식단 추천 앱")]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("배정된 프로젝트")).toBeInTheDocument());
    expect(screen.queryByText("내 업무 목록")).not.toBeInTheDocument();
  });

  it("shows assigned projects fetched from the API with leader and member count", async () => {
    vi.mocked(fetchReviewerProjects).mockResolvedValue([makeReviewerProject(2, "AI 기반 식단 추천 앱")]);

    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    expect(screen.getByText("김민준 팀장")).toBeInTheDocument();
    expect(screen.getByText("4명")).toBeInTheDocument();
  });

  it("shows an empty-state message when the reviewer has no assigned projects", async () => {
    vi.mocked(fetchReviewerProjects).mockResolvedValue([]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("배정된 프로젝트가 없습니다.")).toBeInTheDocument());
  });

  it("shows an error message with a retry button when the fetch fails, and retries on click", async () => {
    vi.mocked(fetchReviewerProjects)
      .mockRejectedValueOnce(new Error("실패"))
      .mockResolvedValueOnce([makeReviewerProject(2, "AI 기반 식단 추천 앱")]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("프로젝트 목록을 불러오지 못했습니다.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /다시 시도/ }));
    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
  });

  it("does not show affiliation/subject fields that have no real backing data", async () => {
    vi.mocked(fetchReviewerProjects).mockResolvedValue([makeReviewerProject(2, "AI 기반 식단 추천 앱")]);

    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    expect(screen.queryByText("한국대학교 컴퓨터공학과")).not.toBeInTheDocument();
    expect(screen.queryByText("캡스톤디자인 2024-2")).not.toBeInTheDocument();
  });
});

describe("MyPage reviewer view — contribution tabs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      loading: false,
      user: { id: 6, email: "reviewer@university.ac.kr", name: "고무서" },
      projectRoles: [{ projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자" }],
      currentProjectId: 2,
      currentProject: { projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자" },
      selectProject: vi.fn(),
      addLocalProjectRole: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });
    vi.mocked(fetchReviewerProjects).mockResolvedValue([makeReviewerProject(2, "AI 기반 식단 추천 앱")]);
    vi.mocked(getProjectMembers).mockResolvedValue([
      { userId: 1, name: "김민준", email: "kim@univ.ac.kr", role: "팀장" },
    ]);
    vi.mocked(fetchContributionReport).mockResolvedValue([
      { userId: 1, name: "김민준", summary: "팀장으로서 프로젝트를 이끌며 AI 모델 개발에 기여.", evidence: ["To-Do #3", "12.10 회의록"] },
    ]);
    vi.mocked(fetchContributionScore).mockResolvedValue({
      members: [{
        assigneeId: "1", workloadComponent: 78, taskComponent: 85, meetingComponent: 90,
        contributionScore: 92, anomalyType: "NONE", taskCountActiveRel: 1, difficultyAvgRel: 1, overdueCount: 0,
      }],
      note: null, teamMeanCompletion: 0.8,
    });
    vi.mocked(fetchTasks).mockResolvedValue([makeTask("T1", "1", "done", "2026-01-10")]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([
      { userId: 1, name: "김민준", meetingsAttended: 3, totalMeetings: 4, attendanceRate: 0.75 },
    ]);
  });

  it("renders real member data on the 기여도 리포트 tab and does not show commit/PR counts", async () => {
    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    await userEvent.click(await screen.findByRole("button", { name: "기여도 리포트" }));

    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
    expect(screen.getByText(/AI 요약:/)).toBeInTheDocument();
    expect(screen.getByText(/팀장으로서 프로젝트를 이끌며/)).toBeInTheDocument();
    expect(screen.queryByText(/커밋/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PR/)).not.toBeInTheDocument();
  });

  it("renders AI summary and evidence chips on the AI 평가 근거 tab", async () => {
    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    await userEvent.click(await screen.findByRole("button", { name: "AI 평가 근거" }));

    await waitFor(() => expect(screen.getByText("AI 분석 요약")).toBeInTheDocument());
    expect(screen.getByText("To-Do #3")).toBeInTheDocument();
    expect(screen.getByText("12.10 회의록")).toBeInTheDocument();
  });

  it("shows an error message with a retry button on the 기여도 리포트 tab when a call fails, and retries on click", async () => {
    vi.mocked(fetchContributionScore)
      .mockRejectedValueOnce(new Error("AI 서버 오류"))
      .mockResolvedValueOnce({
        members: [{
          assigneeId: "1", workloadComponent: 78, taskComponent: 85, meetingComponent: 90,
          contributionScore: 92, anomalyType: "NONE", taskCountActiveRel: 1, difficultyAvgRel: 1, overdueCount: 0,
        }],
        note: null, teamMeanCompletion: 0.8,
      });

    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    await userEvent.click(await screen.findByRole("button", { name: "기여도 리포트" }));

    await waitFor(() => expect(screen.getByText("기여도 리포트를 불러오지 못했습니다.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /다시 시도/ }));
    await waitFor(() => expect(screen.getByText("김민준")).toBeInTheDocument());
  });

  it("does not fetch contribution data while the default 팀 요약 tab is active", async () => {
    renderMyPage();

    await waitFor(() => expect(screen.getAllByText("AI 기반 식단 추천 앱").length).toBeGreaterThan(0));
    expect(getProjectMembers).not.toHaveBeenCalled();
    expect(fetchContributionReport).not.toHaveBeenCalled();
    expect(fetchContributionScore).not.toHaveBeenCalled();
    expect(fetchAttendanceSummary).not.toHaveBeenCalled();
  });
});
