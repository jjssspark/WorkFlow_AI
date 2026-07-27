import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemberDrilldownPanel, buildWorkloadEvidenceSentences } from "./MemberDrilldownPanel";
import { fetchAttendanceDetail, fetchMeeting } from "../../meetings/libs/utils/meetingAiApi";
import { fetchChecklist } from "../../board/libs/utils/checklistApi";
import { fetchTaskResult } from "../../board/libs/utils/taskResultApi";
import type { Task } from "../../board/libs/types/task";
import type { ContributionMemberScoreDto } from "../libs/utils/contributorsApi";

vi.mock("../../meetings/libs/utils/meetingAiApi", () => ({
  fetchAttendanceDetail: vi.fn(),
  fetchMeeting: vi.fn(),
}));

vi.mock("../../board/libs/utils/checklistApi", () => ({
  fetchChecklist: vi.fn(),
}));

vi.mock("../../board/libs/utils/taskResultApi", () => ({
  fetchTaskResult: vi.fn(),
}));

function makeTask(id: string, title: string, status: Task["status"]): Task {
  return { id, title, status, priority: "medium", assignee: "1", dueDate: "", labels: [], category: "backend", position: 0, pendingApproval: false, startDate: "", extraFields: {} };
}

describe("MemberDrilldownPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("groups tasks by status in tasks mode", () => {
    const tasks = [
      makeTask("A", "AI 모델 학습 파이프라인 구축", "done"),
      makeTask("B", "데이터 전처리 스크립트 작성", "inprogress"),
    ];

    render(
      <MemberDrilldownPanel
        mode="tasks"
        memberName="김민준"
        memberTasks={tasks}
        projectId={1}
        userId={1}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("AI 모델 학습 파이프라인 구축")).toBeInTheDocument();
    expect(screen.getByText("데이터 전처리 스크립트 작성")).toBeInTheDocument();
  });

  it("업무 카드 클릭 시 fetchChecklist와 fetchTaskResult를 호출하고 읽기 전용 근거를 표시한다", async () => {
    vi.mocked(fetchChecklist).mockResolvedValue([
      { id: "c1", label: "API 설계", done: true },
      { id: "c2", label: "테스트 작성", done: false },
    ]);
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "파이프라인 구축 완료",
      updatedAt: "2026-12-01T00:00:00Z",
      links: [{ id: "l1", url: "https://github.com/example/repo", title: "PR 링크" }],
      files: [{ id: "f1", fileName: "report.pdf", size: 2048, contentType: "application/pdf" }],
    });
    const user = userEvent.setup();
    const tasks = [makeTask("A", "AI 모델 학습 파이프라인 구축", "done")];

    render(
      <MemberDrilldownPanel mode="tasks" memberName="김민준" memberTasks={tasks} projectId={1} userId={1} onClose={() => {}} />
    );
    await user.click(screen.getByText("AI 모델 학습 파이프라인 구축"));

    await waitFor(() => expect(screen.getByText("API 설계")).toBeInTheDocument());
    expect(fetchChecklist).toHaveBeenCalledWith("A", 1);
    expect(fetchTaskResult).toHaveBeenCalledWith("A", 1);
    expect(screen.getByText("테스트 작성")).toBeInTheDocument();
    expect(screen.getByText("파이프라인 구축 완료")).toBeInTheDocument();
    expect(screen.getByText("PR 링크")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("체크리스트 조회가 실패해도 패널은 유지되고 실패한 영역에만 에러 문구가 표시된다", async () => {
    vi.mocked(fetchChecklist).mockRejectedValue(new Error("network error"));
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "파이프라인 리팩토링 완료", updatedAt: null, links: [], files: [],
    });
    const user = userEvent.setup();
    const tasks = [makeTask("A", "AI 모델 학습 파이프라인 구축", "done")];

    render(
      <MemberDrilldownPanel mode="tasks" memberName="김민준" memberTasks={tasks} projectId={1} userId={1} onClose={() => {}} />
    );
    await user.click(screen.getByText("AI 모델 학습 파이프라인 구축"));

    await waitFor(() => expect(screen.getByText("체크리스트를 불러오지 못했습니다.")).toBeInTheDocument());
    expect(screen.getByText("파이프라인 리팩토링 완료")).toBeInTheDocument();
  });

  it("fetches and shows attendance detail in meetings mode", async () => {
    vi.mocked(fetchAttendanceDetail).mockResolvedValue([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
      { meetingId: "15", title: "12.11 스프린트 리뷰", meetingDate: "2026-12-11", attended: false },
    ]);

    render(
      <MemberDrilldownPanel
        mode="meetings"
        memberName="김민준"
        memberTasks={[]}
        projectId={1}
        userId={1}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("12.10 팀 정기 회의")).toBeInTheDocument());
    expect(screen.getByText("12.11 스프린트 리뷰")).toBeInTheDocument();
    expect(fetchAttendanceDetail).toHaveBeenCalledWith("1", 1);
  });

  it("shows loading state while fetching attendance detail", () => {
    vi.mocked(fetchAttendanceDetail).mockReturnValue(new Promise(() => {}));

    render(
      <MemberDrilldownPanel
        mode="meetings"
        memberName="김민준"
        memberTasks={[]}
        projectId={1}
        userId={1}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("불러오는 중...")).toBeInTheDocument();
  });

  it("shows error state when attendance detail fetch fails", async () => {
    vi.mocked(fetchAttendanceDetail).mockRejectedValue(new Error("network error"));

    render(
      <MemberDrilldownPanel
        mode="meetings"
        memberName="김민준"
        memberTasks={[]}
        projectId={1}
        userId={1}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("회의 참여 내역을 불러오지 못했습니다.")).toBeInTheDocument());
  });

  it("shows empty state when attendance detail is empty", async () => {
    vi.mocked(fetchAttendanceDetail).mockResolvedValue([]);

    render(
      <MemberDrilldownPanel
        mode="meetings"
        memberName="김민준"
        memberTasks={[]}
        projectId={1}
        userId={1}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("등록된 회의가 없습니다.")).toBeInTheDocument());
  });

  it("회의 카드 클릭 시 fetchMeeting을 호출하고 완료된 AI 분석 결과를 표시한다", async () => {
    vi.mocked(fetchAttendanceDetail).mockResolvedValue([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
    ]);
    vi.mocked(fetchMeeting).mockResolvedValue({
      meetingId: "12", projectId: "1", status: "COMPLETED", sourceType: "document",
      fileName: null, analysisSource: "FASTAPI", errorMessage: null, attendees: [],
      analysis: {
        summary: "이번 주 스프린트 진행 상황을 공유했다.",
        decisions: ["API 스펙을 v2로 확정한다"],
        todos: [{ title: "배포 스크립트 작성", description: "", assignee_candidate: "김민준", assignee_id: "1", due_date: null, priority: "HIGH", category: "devops", needs_leader_review: false }],
        risks: ["일정 지연 가능성 있음"],
        keywords: [],
        meeting_meta: { title: "12.10 팀 정기 회의", meeting_date: "2026-12-10", participants: [] },
      },
    });
    const user = userEvent.setup();

    render(
      <MemberDrilldownPanel mode="meetings" memberName="김민준" memberTasks={[]} projectId={1} userId={1} onClose={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("12.10 팀 정기 회의")).toBeInTheDocument());
    await user.click(screen.getByText("12.10 팀 정기 회의"));

    await waitFor(() => expect(screen.getByText("이번 주 스프린트 진행 상황을 공유했다.")).toBeInTheDocument());
    expect(fetchMeeting).toHaveBeenCalledWith("1", "12");
    expect(screen.getByText("API 스펙을 v2로 확정한다")).toBeInTheDocument();
    expect(screen.getByText("배포 스크립트 작성")).toBeInTheDocument();
    expect(screen.getByText("일정 지연 가능성 있음")).toBeInTheDocument();
  });

  it("회의 분석이 아직 완료되지 않았으면 상태 안내 문구를 표시한다", async () => {
    vi.mocked(fetchAttendanceDetail).mockResolvedValue([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
    ]);
    vi.mocked(fetchMeeting).mockResolvedValue({
      meetingId: "12", projectId: "1", status: "PROCESSING", sourceType: "document",
      fileName: null, analysisSource: null, errorMessage: null, attendees: [], analysis: null,
    });
    const user = userEvent.setup();

    render(
      <MemberDrilldownPanel mode="meetings" memberName="김민준" memberTasks={[]} projectId={1} userId={1} onClose={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("12.10 팀 정기 회의")).toBeInTheDocument());
    await user.click(screen.getByText("12.10 팀 정기 회의"));

    await waitFor(() => expect(screen.getByText("AI 분석이 아직 진행 중입니다.")).toBeInTheDocument());
  });

  it("회의 상세 조회 실패 시 에러 문구를 표시한다", async () => {
    vi.mocked(fetchAttendanceDetail).mockResolvedValue([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
    ]);
    vi.mocked(fetchMeeting).mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();

    render(
      <MemberDrilldownPanel mode="meetings" memberName="김민준" memberTasks={[]} projectId={1} userId={1} onClose={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("12.10 팀 정기 회의")).toBeInTheDocument());
    await user.click(screen.getByText("12.10 팀 정기 회의"));

    await waitFor(() => expect(screen.getByText("회의 상세를 불러오지 못했습니다.")).toBeInTheDocument());
  });
});

describe("MemberDrilldownPanel workload mode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeEvidence(overrides: Partial<ContributionMemberScoreDto> = {}): ContributionMemberScoreDto {
    return {
      assigneeId: "1", workloadComponent: 17.5, taskComponent: 80.0, meetingComponent: 80.0,
      contributionScore: 60.0, anomalyType: "배정량 불균형", taskCountActiveRel: 0.3, taskCountTotalRel: 0.3,
      difficultyAvgRel: 0.9, overdueCount: 0, ...overrides,
    };
  }

  it("mode가 workload이면 신규 fetch 없이 즉시 배지와 근거 문장을 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}} workloadEvidence={makeEvidence()} teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("배정량 불균형")).toBeInTheDocument();
    expect(screen.getByText("배정된 업무 자체가 팀 평균 대비 0.3배 적습니다.")).toBeInTheDocument();
    expect(fetchAttendanceDetail).not.toHaveBeenCalled();
  });

  it("anomalyType이 과부하 의심이면 해당 배지를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}} workloadEvidence={makeEvidence({ anomalyType: "과부하 의심", taskCountActiveRel: 1.8 })}
        teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("과부하 의심")).toBeInTheDocument();
  });

  it("workloadEvidence가 없으면 에러 문구를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("편중도 근거를 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("teamMeanCompletion이 없으면 완료율 비교 없이 실측값만 표시한다(팀 평균 오도 방지)", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}} workloadEvidence={makeEvidence()}
      />
    );

    expect(screen.getByText(/팀 평균값을 불러오지 못해 비교는 표시하지 않습니다/)).toBeInTheDocument();
  });

  it("구버전 FastAPI 혼합 배포로 신규 필드가 null이면 크래시 대신 안내 문구를 표시한다", () => {
    render(
      <MemberDrilldownPanel
        mode="workload" memberName="김민준" memberTasks={[]} projectId={1} userId={1}
        onClose={() => {}}
        workloadEvidence={makeEvidence({ taskCountActiveRel: null as unknown as number })}
        teamMeanCompletion={0.6}
      />
    );

    expect(screen.getByText("편중도 근거 데이터가 불완전합니다. 새로고침 후 다시 시도해주세요.")).toBeInTheDocument();
  });
});

describe("buildWorkloadEvidenceSentences", () => {
  it("과부하 의심: 업무량/난이도/지연/완료율 문장을 모두 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "과부하 의심",
      taskCountActiveRel: 1.8,
      taskCountTotalRel: 1.5,
      difficultyAvgRel: 1.4,
      overdueCount: 2,
      completionRate: 0.4,
      teamMeanCompletionRate: 0.6,
    });

    expect(sentences).toEqual([
      "진행 중인 업무가 팀 평균 대비 1.8배 많습니다.",
      "담당 업무의 평균 난이도가 팀 평균보다 1.4배 높습니다.",
      "마감이 지난 업무가 2건 있습니다.",
      "업무 완료율은 40%로 팀 평균(60%)보다 낮습니다.",
    ]);
  });

  it("과부하 의심이지만 업무량/난이도가 평균 이하이고 지연도 없으면 완료율 문장만 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "과부하 의심",
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyAvgRel: 1.0,
      overdueCount: 0,
      completionRate: 0.3,
      teamMeanCompletionRate: 0.5,
    });

    expect(sentences).toEqual(["업무 완료율은 30%로 팀 평균(50%)보다 낮습니다."]);
  });

  it("배정량 불균형: 배정량 감소와 완료율 문장을 생성한다(진행중 업무 개수가 아니라 전체 배정량 기준)", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "배정량 불균형",
      taskCountActiveRel: 0.0,
      taskCountTotalRel: 0.3,
      difficultyAvgRel: 0.9,
      overdueCount: 0,
      completionRate: 0.95,
      teamMeanCompletionRate: 0.7,
    });

    expect(sentences).toEqual([
      "배정된 업무 자체가 팀 평균 대비 0.3배 적습니다.",
      "업무 완료율은 95%로 팀 평균(70%)보다 높습니다.",
    ]);
  });

  it("진행중 업무가 0이어도(배정 업무 완료) 문구는 taskCountTotalRel(배정량 기준)로 생성된다(회귀 테스트)", () => {
    // 백엔드 anomaly_type이 "배정량 불균형"으로 내려오는 경우, 문장 생성기 레벨에서도
    // taskCountActiveRel(진행중 업무 비율)이 아니라 taskCountTotalRel(배정량 기준)을
    // 쓴다는 걸 명확히 하기 위해 activeRel=0인 케이스를 별도로 검증한다.
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "배정량 불균형",
      taskCountActiveRel: 0.0,
      taskCountTotalRel: 1.0,
      difficultyAvgRel: 1.0,
      overdueCount: 0,
      completionRate: 1.0,
      teamMeanCompletionRate: 0.26,
    });

    expect(sentences[0]).toBe("배정된 업무 자체가 팀 평균 대비 1.0배 적습니다.");
  });

  it("정상: 편중이 없다는 문장 하나만 생성한다", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "정상",
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyAvgRel: 1.0,
      overdueCount: 0,
      completionRate: 0.8,
      teamMeanCompletionRate: 0.8,
    });

    expect(sentences).toEqual(["팀 평균과 비교했을 때 업무량·난이도·완료율 모두 특별한 편중이 없습니다."]);
  });

  it("teamMeanCompletionRate가 null이면 팀 평균과 비교하지 않고 실측 완료율만 표시한다(팀 평균 오도 방지 회귀 테스트)", () => {
    const sentences = buildWorkloadEvidenceSentences({
      anomalyType: "과부하 의심",
      taskCountActiveRel: 1.0,
      taskCountTotalRel: 1.0,
      difficultyAvgRel: 1.0,
      overdueCount: 0,
      completionRate: 0.3,
      teamMeanCompletionRate: null,
    });

    expect(sentences).toEqual([
      "업무 완료율은 30%입니다. (팀 평균값을 불러오지 못해 비교는 표시하지 않습니다.)",
    ]);
  });
});
