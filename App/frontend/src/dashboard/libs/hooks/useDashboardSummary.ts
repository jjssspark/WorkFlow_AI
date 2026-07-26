import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardSummary } from "../utils/dashboardApi";
import type { DashboardSummaryResponse } from "../types/dashboard";

export function useDashboardSummary(projectId: string | number | null | undefined) {
  const [data, setData] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 최초 로드 이후의 refetch에서는 loading을 true로 만들지 않는다 — 카드 값이 "..."로 깜빡였다가
  // 다시 채워지는 대신, 새 데이터가 도착했을 때 바뀐 값만 조용히 갱신되게 한다.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectId]);

  // cleanup 함수(() => void)를 반환하면 호출부의 `await refetch()`가 fetch 완료를 기다리지 못한다 — Promise를 반환해야 한다.
  const refetch = useCallback(async (): Promise<void> => {
    if (projectId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboardSummary(projectId);
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
