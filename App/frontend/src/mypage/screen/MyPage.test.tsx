import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MyPage } from "./MyPage";
import { fetchTasks } from "../../board/libs/utils/taskApi";
import { getMyEvaluation } from "../../global/api/evaluationApi";
import type { Task } from "../../board/libs/types/task";
import { useAuth } from "../../global/hooks/useAuth";
import { fetchMyPersonalComments, replyToPersonalComment } from "../libs/api/personalCommentApi";
import { toast } from "sonner";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../board/libs/utils/taskApi", () => ({
  fetchTasks: vi.fn(),
}));

vi.mock("../../global/api/evaluationApi", () => ({
  getMyEvaluation: vi.fn(),
}));

vi.mock("../libs/api/personalCommentApi", () => ({
  fetchMyPersonalComments: vi.fn(),
  replyToPersonalComment: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function makeTask(id: string, assignee: string, status: Task["status"], dueDate: string): Task {
  return { id, title: `업무 ${id}`, status, priority: "medium", assignee, dueDate, labels: [], category: "frontend", position: 0, pendingApproval: false, startDate: "", extraFields: {} };
}

function renderMyPage(initialEntry: string = "/mypage") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MyPage />
    </MemoryRouter>
  );
}

describe("MyPage member view", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: false, score: null, finalRevealed: false, totalScore: null,
      reviewerScore: null, grade: null, commentRevealed: false, comment: null,
    });
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([]);
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      loading: false,
      projectContextReady: true,
      user: { id: 1, email: "seo.yeon@university.ac.kr", name: "이서연", affiliation: null, field: null, githubUsername: null, avatarUrl: null, isAdmin: false },
      projectRoles: [{ projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원", type: null, year: null, taskProgress: 0 }],
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원", type: null, year: null, taskProgress: 0 },
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
      contributionRevealed: false, score: null, finalRevealed: false, totalScore: null,
      reviewerScore: null, grade: null, commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(getMyEvaluation).toHaveBeenCalledWith(1));
    expect(screen.queryByText("공개된 평가 결과")).not.toBeInTheDocument();
  });

  it("shows the reviewer-published score once revealed, hidden behind a reveal button first", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: true, score: 88, finalRevealed: true, totalScore: 89.2,
      reviewerScore: 90, grade: "A+", commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(screen.getByText("공개된 평가 결과")).toBeInTheDocument());
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /결과 확인하기/ }));
    // 기여 점수/심사자 점수/총합/학점 네 값이 모두 표시되고, 총합(89.20)이 기여 점수(88.00)를
    // 덮어쓰지 않는다(회귀 테스트 — 과거엔 score 필드를 공유해 총합이 기여 점수를 덮어썼다).
    expect(screen.getByText("88.00")).toBeInTheDocument();
    expect(screen.getByText("90.00")).toBeInTheDocument();
    expect(screen.getByText("89.20")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
  });

  it("기여 점수만 공개되고 총합/학점은 아직 비공개일 때, 기여 점수만 표시하고 총합/심사자점수/학점 칸은 '-'로 숨긴다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: true, score: 76.12, finalRevealed: false, totalScore: null,
      reviewerScore: null, grade: null, commentRevealed: false, comment: null,
    });

    renderMyPage();

    await waitFor(() => expect(screen.getByText("공개된 평가 결과")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /결과 확인하기/ }));
    expect(screen.getByText("76.12")).toBeInTheDocument();
    // 심사자 점수/총합/학점은 아직 공개되지 않아 "-"로 표시된다.
    expect(screen.getAllByText("-")).toHaveLength(3);
  });

  it("심사 코멘트가 공개되면 개인 코멘트/피드백 목록 맨 앞에 심사자 코멘트가 나타난다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(getMyEvaluation).mockResolvedValue({
      contributionRevealed: false, score: null, finalRevealed: false, totalScore: null,
      reviewerScore: null, grade: null, commentRevealed: true, comment: "팀장으로서 팀을 잘 이끌어주고 있습니다.",
    });

    renderMyPage();

    await waitFor(() =>
      expect(screen.getByText("팀장으로서 팀을 잘 이끌어주고 있습니다.")).toBeInTheDocument(),
    );
    expect(screen.getByText("심사자 코멘트")).toBeInTheDocument();
    // 코멘트만 공개된 상태이므로 "공개된 평가 결과" 카드는 아직 뜨지 않는다.
    expect(screen.queryByText("공개된 평가 결과")).not.toBeInTheDocument();
  });

  it("심사자 코멘트/답글 목록이 실제 API에서 렌더링된다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("UI가 깔끔하네요")).toBeInTheDocument());
    expect(screen.getByText("심사자")).toBeInTheDocument();
  });

  it("답글이 있으면 답글 작성 UI 대신 답글 내용을 보여준다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
      { id: 2, authorId: 1, authorName: "이서연", parentId: 1, content: "감사합니다!", createdAt: "2026-07-25T06:01:00.000Z" },
    ]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("감사합니다!")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("답글 작성...")).not.toBeInTheDocument();
  });

  it("답글이 없는 코멘트에 답글을 작성하면 replyToPersonalComment가 호출되고 목록이 갱신된다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments)
      .mockResolvedValueOnce([
        { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
      ])
      .mockResolvedValueOnce([
        { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
        { id: 2, authorId: 1, authorName: "이서연", parentId: 1, content: "감사합니다!", createdAt: "2026-07-25T06:01:00.000Z" },
      ]);
    vi.mocked(replyToPersonalComment).mockResolvedValue({
      id: 2, authorId: 1, authorName: "이서연", parentId: 1, content: "감사합니다!", createdAt: "2026-07-25T06:01:00.000Z",
    });

    renderMyPage();

    await waitFor(() => expect(screen.getByText("UI가 깔끔하네요")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("답글 작성..."), "감사합니다!");
    await userEvent.click(screen.getByRole("button", { name: "답글" }));

    expect(replyToPersonalComment).toHaveBeenCalledWith(1, 1, "감사합니다!");
    await waitFor(() => expect(screen.getByText("감사합니다!")).toBeInTheDocument());
  });

  it("코멘트 카드를 클릭하면 상세 팝업이 뜬다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    renderMyPage();

    await waitFor(() => expect(screen.getByText("UI가 깔끔하네요")).toBeInTheDocument());
    await userEvent.click(screen.getByText("UI가 깔끔하네요"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("?commentId=<원 코멘트 id>로 진입하면 해당 원 코멘트 팝업이 자동으로 열린다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    renderMyPage("/mypage?commentId=1");

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(within(screen.getByRole("dialog")).getByText("UI가 깔끔하네요")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("?commentId=<답글 id>로 진입하면 그 답글의 부모 스레드(원 코멘트+답글) 팝업이 열린다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
      { id: 2, authorId: 1, authorName: "이서연", parentId: 1, content: "감사합니다!", createdAt: "2026-07-25T06:01:00.000Z" },
    ]);

    renderMyPage("/mypage?commentId=2");

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("UI가 깔끔하네요")).toBeInTheDocument();
    expect(dialog.getByText("감사합니다!")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("?commentId=<목록에 없는 id>로 진입하면 팝업 없이 삭제/다른 프로젝트 안내 토스트가 뜬다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    renderMyPage("/mypage?commentId=999");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("삭제되었거나 다른 프로젝트의 코멘트입니다."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("콜드 로드 중(useAuth의 projectContextReady가 아직 false)에는 목록이 비어 있어도 거짓 not-found 토스트를 띄우지 않고, projectContextReady가 true로 바뀌며 실제 데이터가 로드되면 그제서야 팝업을 연다", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchMyPersonalComments).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 깔끔하네요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    // useAuth()가 아직 currentProjectId를 확정하지 못한 콜드 로드 첫 렌더 상태를 흉내낸다.
    const authState = {
      isAuthenticated: false,
      loading: true,
      projectContextReady: false,
      user: null,
      projectRoles: [],
      currentProjectId: null,
      currentProject: null,
      selectProject: vi.fn(),
      addLocalProjectRole: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    };
    vi.mocked(useAuth).mockImplementation(() => authState);

    const { rerender } = render(
      <MemoryRouter initialEntries={["/mypage?commentId=1"]}>
        <MyPage />
      </MemoryRouter>
    );

    // 아직 projectContextReady가 false인 동안에는 목록이 비어 있어도 "찾을 수 없음" 토스트를 띄우면 안 된다.
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // useAuth가 실제 프로젝트로 resolve된 상태를 흉내낸다.
    Object.assign(authState, {
      isAuthenticated: true,
      loading: false,
      projectContextReady: true,
      user: { id: 1, email: "seo.yeon@university.ac.kr", name: "이서연", affiliation: null, field: null, githubUsername: null, avatarUrl: null, isAdmin: false },
      projectRoles: [{ projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원", type: null, year: null, taskProgress: 0 }],
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원", type: null, year: null, taskProgress: 0 },
    });

    rerender(
      <MemoryRouter initialEntries={["/mypage?commentId=1"]}>
        <MyPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(within(screen.getByRole("dialog")).getByText("UI가 깔끔하네요")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("MyPage 심사자 접근", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      loading: false,
      projectContextReady: true,
      user: { id: 6, email: "reviewer@university.ac.kr", name: "고무서", affiliation: null, field: null, githubUsername: null, avatarUrl: null, isAdmin: false },
      // 현재 프로젝트가 심사자면, projectRoles 첫 항목이 팀원이어도 심사자로 판정해야 한다.
      projectRoles: [
        { projectId: 1, projectTitle: "스마트 주차 관리 시스템", role: "팀원", type: null, year: null, taskProgress: 0 },
        { projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자", type: null, year: null, taskProgress: 0 },
      ],
      currentProjectId: 2,
      currentProject: { projectId: 2, projectTitle: "AI 기반 식단 추천 앱", role: "심사자", type: null, year: null, taskProgress: 0 },
      selectProject: vi.fn(),
      addLocalProjectRole: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });
  });

  it("심사자에게는 마이페이지가 없어 기여도 분석 화면으로 보낸다", async () => {
    render(
      <MemoryRouter initialEntries={["/mypage"]}>
        <Routes>
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/contributors" element={<div>기여도 분석 화면</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("기여도 분석 화면")).toBeInTheDocument();
    expect(screen.queryByText("내 업무 목록")).not.toBeInTheDocument();
  });
});
