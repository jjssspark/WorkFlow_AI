import { useCallback, useEffect, useState } from "react";
import { fetchDashboardActivities } from "../utils/dashboardApi";
import type { ActivityItemDto } from "../types/dashboard";

export function useDashboardActivities(projectId: string | number | null | undefined) {
  const [data, setData] = useState<ActivityItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    if (projectId == null) {
      setData([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    fetchDashboardActivities(projectId)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => load(), [load]);

  return { data, loading, error, refetch: load };
}
