import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useMyTasks } from "./useMyTasks";
import { fetchTasks } from "../../../board/libs/utils/taskApi";
import type { Task } from "../../../board/libs/types/task";

vi.mock("../../../board/libs/utils/taskApi", () => ({
  fetchTasks: vi.fn(),
}));

function makeTask(id: string, assignee: string): Task {
  return { id, title: `Task ${id}`, status: "todo", priority: "medium", assignee, dueDate: "", labels: [], category: "other", position: 0, pendingApproval: false, startDate: "", extraFields: {} };
}

describe("useMyTasks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches project tasks and keeps only the ones assigned to the given user", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([makeTask("A", "1"), makeTask("B", "2"), makeTask("C", "1")]);

    const { result } = renderHook(() => useMyTasks(1, 1));

    expect(result.current.loadState).toBe("loading");
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(fetchTasks).toHaveBeenCalledWith(1);
    expect(result.current.tasks.map((t) => t.id).sort()).toEqual(["A", "C"]);
  });

  it("sets error state when the fetch fails", async () => {
    vi.mocked(fetchTasks).mockRejectedValue(new Error("네트워크 오류"));

    const { result } = renderHook(() => useMyTasks(1, 1));

    await waitFor(() => expect(result.current.loadState).toBe("error"));
  });

  it("does not call fetchTasks and returns an empty ready state when projectId is null", async () => {
    const { result } = renderHook(() => useMyTasks(null, 1));

    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(fetchTasks).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });

  it("does not call fetchTasks and returns an empty ready state when userId is null", async () => {
    const { result } = renderHook(() => useMyTasks(1, null));

    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(fetchTasks).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });
});
