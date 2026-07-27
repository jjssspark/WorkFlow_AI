import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useReviewerContribution } from "./useReviewerContribution";
import { getProjectMembers } from "../../../global/api/projectsApi";
import type { MemberResponse } from "../../../global/api/projectsApi";
import { fetchContributionReport, fetchContributionScore } from "../../../contributors/libs/utils/contributorsApi";
import type { MemberContributionDto, ContributionScoreResult } from "../../../contributors/libs/utils/contributorsApi";
import { fetchTasks } from "../../../board/libs/utils/taskApi";
import type { Task } from "../../../board/libs/types/task";
import { fetchAttendanceSummary } from "../../../meetings/libs/utils/meetingAiApi";
import type { MeetingAttendanceSummaryDto } from "../../../meetings/libs/utils/meetingAiApi";

vi.mock("../../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn(),
}));

vi.mock("../../../contributors/libs/utils/contributorsApi", () => ({
  fetchContributionReport: vi.fn(),
  fetchContributionScore: vi.fn(),
}));

vi.mock("../../../board/libs/utils/taskApi", () => ({
  fetchTasks: vi.fn(),
}));

vi.mock("../../../meetings/libs/utils/meetingAiApi", () => ({
  fetchAttendanceSummary: vi.fn(),
}));

function makeMember(userId: number, name: string, role: MemberResponse["role"]): MemberResponse {
  return { userId, name, email: `${name}@univ.ac.kr`, role };
}

function makeTask(id: string, assignee: string, status: Task["status"]): Task {
  return { id, title: `업무 ${id}`, status, priority: "medium", assignee, dueDate: "", labels: [], category: "frontend", position: 0 };
}

function makeAttendance(userId: number, meetingsAttended: number, totalMeetings: number): MeetingAttendanceSummaryDto {
  return { userId, name: null, meetingsAttended, totalMeetings, attendanceRate: totalMeetings === 0 ? 0 : meetingsAttended / totalMeetings };
}

function makeScoreResult(assigneeId: string): ContributionScoreResult {
  return {
    members: [{
      assigneeId, workloadComponent: 78, taskComponent: 85, meetingComponent: 90,
      contributionScore: 92, anomalyType: "NONE", taskCountActiveRel: 1, difficultyAvgRel: 1, overdueCount: 0,
    }],
    note: null,
    teamMeanCompletion: 0.8,
  };
}

function makeReport(userId: number, name: string): MemberContributionDto[] {
  return [{ userId, name, summary: "AI 요약 텍스트", evidence: ["To-Do #1", "12.10 회의록"] }];
}

describe("useReviewerContribution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty rows immediately in ready state when projectId is null", async () => {
    const { result } = renderHook(() => useReviewerContribution(null));

    expect(result.current.loadState).toBe("ready");
    expect(result.current.rows).toEqual([]);
    expect(getProjectMembers).not.toHaveBeenCalled();
  });

  it("merges members, AI report, AI score, tasks, and attendance into rows keyed by userId", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember(1, "김민준", "팀장")]);
    vi.mocked(fetchContributionReport).mockResolvedValue(makeReport(1, "김민준"));
    vi.mocked(fetchContributionScore).mockResolvedValue(makeScoreResult("1"));
    vi.mocked(fetchTasks).mockResolvedValue([
      makeTask("T1", "1", "done"),
      makeTask("T2", "1", "todo"),
      makeTask("T3", "2", "done"), // 다른 담당자, 제외돼야 함
    ]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([makeAttendance(1, 3, 4)]);

    const { result } = renderHook(() => useReviewerContribution(7));

    expect(result.current.loadState).toBe("loading");
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    expect(result.current.rows).toEqual([{
      userId: 1, name: "김민준", role: "팀장",
      todoDone: 1, todoTotal: 2,
      meetings: 3, meetingsTotal: 4,
      aiSummary: "AI 요약 텍스트", evidence: ["To-Do #1", "12.10 회의록"],
      score: 92, categories: { task: 85, meeting: 90, workload: 78 },
      isPublic: false,
    }]);
    expect(fetchAttendanceSummary).toHaveBeenCalledWith("7");
  });

  it("leaves aiSummary/score/categories null for a member with no matching report/score data", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember(9, "최동혁", "팀원")]);
    vi.mocked(fetchContributionReport).mockResolvedValue([]);
    vi.mocked(fetchContributionScore).mockResolvedValue({ members: [], note: null, teamMeanCompletion: null });
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([]);

    const { result } = renderHook(() => useReviewerContribution(7));

    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.rows).toEqual([{
      userId: 9, name: "최동혁", role: "팀원",
      todoDone: 0, todoTotal: 0, meetings: 0, meetingsTotal: 0,
      aiSummary: null, evidence: [], score: null, categories: null, isPublic: false,
    }]);
  });

  it("sets error state when any of the five calls fails, without exposing partial data", async () => {
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember(1, "김민준", "팀장")]);
    vi.mocked(fetchContributionReport).mockResolvedValue(makeReport(1, "김민준"));
    vi.mocked(fetchContributionScore).mockRejectedValue(new Error("AI 서버 오류"));
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([]);

    const { result } = renderHook(() => useReviewerContribution(7));

    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.rows).toEqual([]);
  });

  it("reload() re-fetches and can recover from an error", async () => {
    vi.mocked(getProjectMembers)
      .mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockResolvedValueOnce([makeMember(1, "김민준", "팀장")]);
    vi.mocked(fetchContributionReport).mockResolvedValue(makeReport(1, "김민준"));
    vi.mocked(fetchContributionScore).mockResolvedValue(makeScoreResult("1"));
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([]);

    const { result } = renderHook(() => useReviewerContribution(7));

    await waitFor(() => expect(result.current.loadState).toBe("error"));
    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.rows[0].name).toBe("김민준");
  });

  it("성공 후 reload()가 실패하면 이전 성공 데이터를 남기지 않고 rows를 비운다", async () => {
    vi.mocked(getProjectMembers)
      .mockResolvedValueOnce([makeMember(1, "김민준", "팀장")])
      .mockRejectedValueOnce(new Error("네트워크 오류"));
    vi.mocked(fetchContributionReport).mockResolvedValue(makeReport(1, "김민준"));
    vi.mocked(fetchContributionScore).mockResolvedValue(makeScoreResult("1"));
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([]);

    const { result } = renderHook(() => useReviewerContribution(7));

    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.rows).toHaveLength(1);

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.rows).toEqual([]);
  });

  it("projectId가 빠르게 바뀌면 늦게 도착한 이전 projectId 응답을 무시하고 최신 데이터만 반영한다", async () => {
    const resolvers = new Map<number, (members: MemberResponse[]) => void>();
    vi.mocked(getProjectMembers).mockImplementation(
      (projectId: number) =>
        new Promise<MemberResponse[]>((resolve) => {
          resolvers.set(projectId, resolve);
        }),
    );
    vi.mocked(fetchContributionReport).mockResolvedValue([]);
    vi.mocked(fetchContributionScore).mockResolvedValue({ members: [], note: null, teamMeanCompletion: null });
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchAttendanceSummary).mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: number }) => useReviewerContribution(projectId),
      { initialProps: { projectId: 1 } },
    );

    expect(result.current.loadState).toBe("loading");

    rerender({ projectId: 2 });

    await act(async () => {
      resolvers.get(2)!([makeMember(2, "이서연", "팀원")]);
    });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    await act(async () => {
      resolvers.get(1)!([makeMember(1, "김민준", "팀장")]);
    });

    expect(result.current.loadState).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].name).toBe("이서연");
  });
});
