import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useDashboardTasks } from "./useDashboardTasks";
import { fetchDashboardTasks } from "../utils/dashboardApi";

vi.mock("../utils/dashboardApi", () => ({
  fetchDashboardTasks: vi.fn(),
}));

describe("useDashboardTasks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads tasks for the given project", async () => {
    vi.mocked(fetchDashboardTasks).mockResolvedValue([{ id: "1" } as any]);

    const { result } = renderHook(() => useDashboardTasks(1));

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });

  it("ignores a stale response from the previous project after switching projectId", async () => {
    // 프로젝트 1 요청은 응답이 늦게 오고, 그 사이 프로젝트 2로 전환해 먼저 응답을 받는
    // 상황을 흉내낸다. 프로젝트 1의 지연 응답이 나중에 도착해도 최신 상태(프로젝트 2
    // 데이터)를 덮어쓰면 안 된다.
    let resolveProjectOne: ((value: any[]) => void) | null = null;
    vi.mocked(fetchDashboardTasks).mockImplementation((projectId) => {
      if (projectId === 1) {
        return new Promise((resolve) => {
          resolveProjectOne = resolve;
        });
      }
      return Promise.resolve([{ id: "project-2-task" } as any]);
    });

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: number }) => useDashboardTasks(projectId),
      { initialProps: { projectId: 1 } }
    );

    rerender({ projectId: 2 });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "project-2-task" }]));

    // 프로젝트 1의 지연된 응답이 뒤늦게 도착한다 - 이미 최신 상태를 덮어쓰면 안 된다.
    resolveProjectOne!([{ id: "project-1-stale-task" } as any]);
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.data).toEqual([{ id: "project-2-task" }]);
  });
});
