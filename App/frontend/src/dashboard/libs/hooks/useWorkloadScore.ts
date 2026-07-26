import { useCallback, useEffect, useState } from "react";
import { fetchWorkloadScore } from "../utils/workloadScoreApi";
import type { WorkloadScoreResult } from "../utils/workloadScoreApi";

export function useWorkloadScore(projectId: string | number | null | undefined) {
  const [data, setData] = useState<WorkloadScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
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
    return fetchWorkloadScore(projectId)
      .then(result => setData(result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
