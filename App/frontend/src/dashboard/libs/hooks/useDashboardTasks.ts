import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardTasks } from "../utils/dashboardApi";
import type { DashboardTaskDto } from "../types/dashboard";

export function useDashboardTasks(projectId: string | number | null | undefined) {
  const [data, setData] = useState<DashboardTaskDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 최초 로드 이후의 refetch(데이터 변경 감지, 액션 후 새로고침 등)에서는 loading을 true로 만들지 않는다 —
  // 그러면 화면이 통째로 "불러오는 중"으로 비워지지 않고, 새 데이터가 도착했을 때 바뀐 항목만 리렌더된다.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectId]);

  // 이전 구현은 cleanup 함수(() => void)를 반환해서, 호출부에서 `await refetch()`를 해도
  // 실제 fetch 완료를 기다리지 못하고 즉시 통과해버리는 문제가 있었다 — 반드시 Promise를 반환해야 한다.
  const refetch = useCallback(async (): Promise<void> => {
    if (projectId == null) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboardTasks(projectId);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
