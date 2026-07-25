import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildGeneratedTodos, deriveCurrentUserRole, MeetingsView } from "./MeetingsView";
import type { MeetingAiResult } from "../libs/types/meetingAiTypes";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, email: "leader@test.com", name: "김민준" },
    projectRoles: [{ projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" }],
    currentProjectId: 1,
    currentProject: { projectId: 1, projectTitle: "테스트 프로젝트", role: "팀장" },
    logout: vi.fn(),
  }),
}));

vi.mock("../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn().mockResolvedValue([
    { userId: 1, name: "김민준", email: "leader@test.com", role: "팀장" },
  ]),
}));

const fetchMeetings = vi.fn();
const fetchMeeting = vi.fn();

vi.mock("../libs/utils/meetingAiApi", () => ({
  analyzeMeeting: vi.fn(),
  confirmMeetingSave: vi.fn(),
  fetchMeeting: (...args: unknown[]) => fetchMeeting(...args),
  fetchMeetings: (...args: unknown[]) => fetchMeetings(...args),
  deleteMeeting: vi.fn(),
  retryMeetingAnalysis: vi.fn(),
  registerMeetingTasks: vi.fn(),
}));

const baseResult = (assignee_id: string | null): MeetingAiResult => ({
  summary: "요약",
  decisions: [],
  risks: [],
  keywords: [],
  meeting_meta: { title: "정기회의", meeting_date: "2026-07-09", participants: ["김민준", "이서연", "박지수", "최동혁"] },
  todos: [
    {
      title: "인증과 권한 구조",
      description: "인증과 권한 구조는 제가 먼저 잡겠습니다.",
      assignee_candidate: "곽진아",
      assignee_id,
      due_date: "2026-07-12",
      priority: "HIGH",
      category: "BACKEND",
      needs_leader_review: assignee_id === null,
    },
  ],
});

describe("buildGeneratedTodos", () => {
  it("leaves the todo unassigned when the server returns a null assignee_id, without defaulting to any member", () => {
    const todos = buildGeneratedTodos(baseResult(null));

    expect(todos[0].assignee).toBe("");
    expect(todos[0].assigned).toBe(false);
  });

  it("trusts the server-provided assignee_id when present, without re-deriving it from assignee_candidate", () => {
    const todos = buildGeneratedTodos(baseResult("3"));

    expect(todos[0].assignee).toBe("3");
    expect(todos[0].assigned).toBe(true);
  });

  it("uses the server-provided evidence_text as the basis when present", () => {
    const result = baseResult(null);
    result.todos[0].evidence_text = "곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다.";

    const todos = buildGeneratedTodos(result);

    expect(todos[0].basis).toBe("곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다.");
  });

  it("falls back to a generic basis when evidence_text is missing, without breaking the UI", () => {
    const result = baseResult(null);
    result.todos[0].evidence_text = undefined;

    const todos = buildGeneratedTodos(result);

    expect(todos[0].basis).toBe("회의록 후보 담당자: 곽진아");
  });
});

describe("deriveCurrentUserRole", () => {
  it("팀장 역할은 leader로 매핑된다", () => {
    expect(deriveCurrentUserRole("팀장")).toBe("leader");
  });

  it("심사자 역할은 reviewer로 매핑된다", () => {
    expect(deriveCurrentUserRole("심사자")).toBe("reviewer");
  });

  it("팀원 역할은 member로 매핑된다", () => {
    expect(deriveCurrentUserRole("팀원")).toBe("member");
  });

  it("역할 정보가 없으면(null/undefined) member로 폴백한다, 하드코딩된 leader로 기본값을 두지 않는다", () => {
    expect(deriveCurrentUserRole(null)).toBe("member");
    expect(deriveCurrentUserRole(undefined)).toBe("member");
  });
});

describe("MeetingsView 홈 탭", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fetchMeetings.mockResolvedValue([
      { meetingId: "1", title: "저장된 정기회의", meetingDate: "2026-07-19", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-19T10:00:00", originalMeetingId: null, tasksRegistered: false },
      { meetingId: "2", title: "미저장 준비회의", meetingDate: "2026-07-20", meetingType: "정기회의", analysisStatus: "completed", savedAt: null, originalMeetingId: null, tasksRegistered: false },
    ]);
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: null,
      errorMessage: null,
      attendees: [],
    });
  });

  it("저장된 회의록 탭을 누르면 savedAt이 있는 회의록만 목록에 보인다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("저장된 정기회의").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(screen.getByText("저장된 정기회의")).toBeInTheDocument();
    expect(screen.queryByText("미저장 준비회의")).not.toBeInTheDocument();
  });

  it("역할분배·업무등록이 안 된 저장 회의록에는 '등록완료' 배지가 보이지 않는다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("저장된 정기회의")).toBeInTheDocument();
    expect(screen.queryByText("등록완료")).not.toBeInTheDocument();
  });

  it("역할분배·업무등록이 완료된 저장 회의록에는 '등록완료' 배지가 보이고, 원본이면 '수정됨' 배지는 보이지 않는다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "3", title: "등록완료된 회의", meetingDate: "2026-07-21", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-21T10:00:00", originalMeetingId: null, tasksRegistered: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("등록완료")).toBeInTheDocument();
    expect(screen.queryByText("수정됨")).not.toBeInTheDocument();
  });

  it("수정본이면서 등록완료된 저장 회의록에는 '등록완료'와 '수정됨' 배지가 모두 보인다", async () => {
    fetchMeetings.mockResolvedValue([
      { meetingId: "4", title: "수정된 회의", meetingDate: "2026-07-22", meetingType: "정기회의", analysisStatus: "completed", savedAt: "2026-07-22T10:00:00", originalMeetingId: "3", tasksRegistered: true },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));

    expect(await screen.findByText("등록완료")).toBeInTheDocument();
    expect(await screen.findByText("수정됨")).toBeInTheDocument();
  });

  it("저장된 회의록 카드를 클릭하면 분석결과가 아니라 회의록 원문이 보인다", async () => {
    const user = userEvent.setup();
    // selected 변경 시 실행되는 다른 useEffect도 fetchMeeting을 호출하므로, mockResolvedValueOnce가 아니라
    // mockResolvedValue로 모든 호출에 transcript를 포함한 응답을 주도록 한다.
    fetchMeeting.mockResolvedValue({
      meetingId: "1",
      projectId: "1",
      status: "COMPLETED",
      sourceType: "document",
      fileName: "meeting.txt",
      analysisSource: "FASTAPI",
      analysis: null,
      errorMessage: null,
      attendees: [],
      transcript: "오늘 회의에서는 신규 기능을 논의했습니다.",
    });
    render(
      <MemoryRouter initialEntries={["/meetings"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "저장된 회의록" }));
    await user.click(await screen.findByText("저장된 정기회의"));

    expect(await screen.findByText("오늘 회의에서는 신규 기능을 논의했습니다.")).toBeInTheDocument();
  });

  it("meetingId 쿼리파라미터가 있으면 저장 여부와 무관하게 분석/업로드 탭에서 해당 회의록 상세가 바로 보인다", async () => {
    // "1"은 beforeEach의 fetchMeetings 목록에서 savedAt이 있는(저장 확정된) 회의록이다.
    // "저장된 회의록" 탭은 목록만 보여주고 클릭해야 내용이 열리므로, 알림 바로가기로 온
    // 사용자에게는 상세가 곧장 뜨는 분석/업로드 탭으로 보내야 한다.
    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=1"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole("button", { name: "분석/업로드" })).toHaveClass("border-blue-600"));
    expect(screen.getByRole("button", { name: "저장된 회의록" })).not.toHaveClass("border-blue-600");
  });

  it("meetingId 쿼리파라미터의 회의록이 아직 저장되지 않았어도(savedAt null) 분석/업로드 탭으로 전환된다", async () => {
    // "2"는 beforeEach의 fetchMeetings 목록에서 savedAt: null(분석 완료, 저장 확정 전) 상태다.
    render(
      <MemoryRouter initialEntries={["/meetings?meetingId=2"]}>
        <MeetingsView />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMeetings).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole("button", { name: "분석/업로드" })).toHaveClass("border-blue-600"));
    expect(screen.getByRole("button", { name: "저장된 회의록" })).not.toHaveClass("border-blue-600");
  });
});
