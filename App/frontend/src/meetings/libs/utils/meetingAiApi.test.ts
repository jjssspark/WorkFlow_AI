import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../../global/api/apiClient";
import { confirmMeetingSave, createMeetingVersion, deleteMeetingAnalysis, fetchAttendanceDetail } from "./meetingAiApi";

vi.mock("../../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("fetchAttendanceDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the per-user attendance detail with userId as a query param", async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
      { meetingId: "15", title: "12.11 스프린트 리뷰", meetingDate: "2026-12-11", attended: false },
    ]);

    const result = await fetchAttendanceDetail("1", 2);

    expect(apiFetch).toHaveBeenCalledWith("/projects/1/meetings/attendance-detail?userId=2");
    expect(result).toEqual([
      { meetingId: "12", title: "12.10 팀 정기 회의", meetingDate: "2026-12-10", attended: true },
      { meetingId: "15", title: "12.11 스프린트 리뷰", meetingDate: "2026-12-11", attended: false },
    ]);
  });
});

describe("confirmMeetingSave", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /save 엔드포인트를 호출해 저장을 확정한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ meetingId: "5", status: "SAVED" });

    const result = await confirmMeetingSave("demo-project", "5");

    expect(apiFetch).toHaveBeenCalledWith("/projects/demo-project/meetings/5/save", { method: "POST" });
    expect(result.status).toBe("SAVED");
  });
});

describe("createMeetingVersion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transcript와 triggerAnalysis를 body로 담아 POST /versions를 호출한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ meetingId: "6", status: "PROCESSING" });

    const result = await createMeetingVersion("demo-project", "5", "수정된 본문", true);

    expect(apiFetch).toHaveBeenCalledWith("/projects/demo-project/meetings/5/versions", {
      method: "POST",
      body: JSON.stringify({ transcript: "수정된 본문", triggerAnalysis: true }),
    });
    expect(result.status).toBe("PROCESSING");
  });
});

describe("deleteMeetingAnalysis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("DELETE /analysis 엔드포인트를 deleteLinkedTasks 쿼리와 함께 호출한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ meetingId: "8", status: "DELETED" });

    const result = await deleteMeetingAnalysis("demo-project", "8", true);

    expect(apiFetch).toHaveBeenCalledWith(
      "/projects/demo-project/meetings/8/analysis?deleteLinkedTasks=true",
      { method: "DELETE" },
      true,
      10000
    );
    expect(result.status).toBe("DELETED");
  });

  it("deleteLinkedTasks 기본값은 false다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ meetingId: "8", status: "DELETED" });

    await deleteMeetingAnalysis("demo-project", "8");

    expect(apiFetch).toHaveBeenCalledWith(
      "/projects/demo-project/meetings/8/analysis?deleteLinkedTasks=false",
      { method: "DELETE" },
      true,
      10000
    );
  });
});
