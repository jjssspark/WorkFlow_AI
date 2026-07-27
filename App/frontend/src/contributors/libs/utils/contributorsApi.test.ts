import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../../global/api/apiClient";
import { fetchContributionReport, fetchContributionScore } from "./contributorsApi";

vi.mock("../../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("fetchContributionReport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("converts snake_case response to camelCase", async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { user_id: 1, name: "김민준", summary: "요약입니다", evidence: ["To-Do 8/10건 완료"] },
    ]);

    const result = await fetchContributionReport(1);

    expect(apiFetch).toHaveBeenCalledWith("/ai/contribution/report", {
      method: "POST",
      body: JSON.stringify({ project_id: 1 }),
    });
    expect(result).toEqual([
      { userId: 1, name: "김민준", summary: "요약입니다", evidence: ["To-Do 8/10건 완료"] },
    ]);
  });
});

describe("fetchContributionScore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("converts snake_case response to camelCase", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      schema_version: "1.0",
      project_id: 1,
      members: [
        {
          assignee_id: "3",
          workload_component: 100.0,
          task_component: 80.0,
          meeting_component: 80.0,
          contribution_score: 86.7,
          anomaly_type: "과부하 의심",
          task_count_active_rel: 1.8,
          task_count_total_rel: 1.5,
          difficulty_avg_rel: 1.4,
          overdue_count: 2,
        },
      ],
      note: null,
      team_mean_completion: 0.65,
    });

    const result = await fetchContributionScore(1);

    expect(apiFetch).toHaveBeenCalledWith("/ai/contribution/score", {
      method: "POST",
      body: JSON.stringify({ project_id: 1 }),
    });
    expect(result).toEqual({
      members: [
        {
          assigneeId: "3",
          workloadComponent: 100.0,
          taskComponent: 80.0,
          meetingComponent: 80.0,
          contributionScore: 86.7,
          anomalyType: "과부하 의심",
          taskCountActiveRel: 1.8,
          taskCountTotalRel: 1.5,
          difficultyAvgRel: 1.4,
          overdueCount: 2,
        },
      ],
      note: null,
      teamMeanCompletion: 0.65,
    });
  });

  it("passes through a non-null note", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      schema_version: "1.0",
      project_id: 1,
      members: [],
      note: "배정된 업무가 없어 기여도 점수를 계산할 수 없습니다.",
      team_mean_completion: null,
    });

    const result = await fetchContributionScore(1);

    expect(result).toEqual({
      members: [],
      note: "배정된 업무가 없어 기여도 점수를 계산할 수 없습니다.",
      teamMeanCompletion: null,
    });
  });
});
