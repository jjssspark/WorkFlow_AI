import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardProgress, refreshDelayRisk } from "../utils/dashboardApi";
import type { ProgressDetailResponse } from "../types/dashboard";

export function useDashboardProgress(projectId: string | number | null | undefined) {
  const [data, setData] = useState<ProgressDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 최초 로드 이후의 refetch에서는 loading을 true로 만들지 않는다 — 화면 전체가 다시 "불러오는 중"으로
  // 비워지지 않고, 새 데이터가 도착했을 때 바뀐 값만 조용히 갱신되게 한다.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectId]);

  const load = useCallback(() => {
    if (projectId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return Promise.resolve();
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    return fetchDashboardProgress(projectId)
      .then(result => setData(result))
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        hasLoadedRef.current = true;
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const runDelayRiskAnalysis = useCallback(() => {
    if (projectId == null) {
      setError("프로젝트를 먼저 선택해주세요.");
      return Promise.resolve();
    }
    setRefreshing(true);
    setError(null);
    return refreshDelayRisk(projectId)
      .then(result => setData(result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [projectId]);

  return { data, loading, refreshing, error, refetch: load, runDelayRiskAnalysis };
}
