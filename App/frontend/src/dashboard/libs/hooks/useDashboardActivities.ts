import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardActivities } from "../utils/dashboardApi";
import type { ActivityItemDto } from "../types/dashboard";

export function useDashboardActivities(projectId: string | number | null | undefined) {
  const [data, setData] = useState<ActivityItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectId]);

  // cleanup 함수(() => void)를 반환하면 호출부의 `await refetch()`가 fetch 완료를 기다리지 못한다 — Promise를 반환해야 한다.
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
      const result = await fetchDashboardActivities(projectId);
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
