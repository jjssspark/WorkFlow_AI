import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { usePendingApprovalCount } from "./usePendingApprovalCount";
import { fetchPendingApprovalTasks } from "../../../board/libs/utils/taskApi";
import type { Task } from "../../../board/libs/types/task";
import { publishPendingApprovalCount } from "../utils/pendingApprovalEvents";

vi.mock("../../../board/libs/utils/taskApi", async () => {
  const actual = await vi.importActual<typeof import("../../../board/libs/utils/taskApi")>(
    "../../../board/libs/utils/taskApi"
  );
  return { ...actual, fetchPendingApprovalTasks: vi.fn() };
});

function makeTask(id: string): Task {
  return {
    id, title: "제목", status: "inprogress", priority: "medium", assignee: "1",
    dueDate: "2026-08-01", labels: [], category: "backend", position: 0,
    pendingApproval: true, startDate: "2026-07-20", extraFields: {},
  };
}

describe("usePendingApprovalCount", () => {
  beforeEach(() => {
    vi.mocked(fetchPendingApprovalTasks).mockReset();
  });

  it("returns the number of pending-approval tasks", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([makeTask("T1"), makeTask("T2")]);

    const { result } = renderHook(() => usePendingApprovalCount(1));

    await waitFor(() => expect(result.current).toBe(2));
  });

  it("does not call the API when disabled", async () => {
    const { result } = renderHook(() => usePendingApprovalCount(1, false));

    expect(result.current).toBe(0);
    expect(fetchPendingApprovalTasks).not.toHaveBeenCalled();
  });

  it("does not call the API when no project is selected", () => {
    const { result } = renderHook(() => usePendingApprovalCount(null));

    expect(result.current).toBe(0);
    expect(fetchPendingApprovalTasks).not.toHaveBeenCalled();
  });

  it("silently falls back to 0 when the fetch fails", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockRejectedValue(new Error("네트워크 오류"));

    const { result } = renderHook(() => usePendingApprovalCount(1));

    await waitFor(() => expect(fetchPendingApprovalTasks).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });

  it("does not call the API and returns 0 when there is no project context", () => {
    const { result } = renderHook(() => usePendingApprovalCount(null));

    expect(result.current).toBe(0);
    expect(fetchPendingApprovalTasks).not.toHaveBeenCalled();
  });

  it("resets to 0 immediately when projectId changes, instead of showing the previous project's count", async () => {
    let resolveSecond: (tasks: Task[]) => void = () => {};
    vi.mocked(fetchPendingApprovalTasks)
      .mockResolvedValueOnce([makeTask("T1"), makeTask("T2")])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { result, rerender } = renderHook(
      ({ projectId }) => usePendingApprovalCount(projectId),
      { initialProps: { projectId: 1 } }
    );
    await waitFor(() => expect(result.current).toBe(2));

    rerender({ projectId: 2 });
    expect(result.current).toBe(0);

    resolveSecond([makeTask("T3")]);
    await waitFor(() => expect(result.current).toBe(1));
  });

  it("updates immediately when the approval list publishes a changed count", async () => {
    vi.mocked(fetchPendingApprovalTasks).mockResolvedValue([makeTask("T1"), makeTask("T2")]);
    const { result } = renderHook(() => usePendingApprovalCount(1));
    await waitFor(() => expect(result.current).toBe(2));

    act(() => publishPendingApprovalCount(1, 1));

    expect(result.current).toBe(1);
  });
});
