import { useCallback, useEffect, useState } from "react";
import { fetchDashboardProgress, refreshDelayRisk } from "../utils/dashboardApi";
import type { ProgressDetailResponse } from "../types/dashboard";

export function useDashboardProgress(projectId: string | number | null | undefined) {
  const [data, setData] = useState<ProgressDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (projectId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return Promise.resolve();
    }
    setLoading(true);
    setError(null);
    return fetchDashboardProgress(projectId)
      .then(result => setData(result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
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
