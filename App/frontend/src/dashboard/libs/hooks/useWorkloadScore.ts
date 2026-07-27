import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWorkloadScore } from "../utils/workloadScoreApi";
import type { WorkloadScoreResult } from "../utils/workloadScoreApi";

export function useWorkloadScore(projectId: string | number | null | undefined) {
  const [data, setData] = useState<WorkloadScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectId]);

  // 요청 세대(generation) 번호 - 응답이 도착했을 때 이 값이 요청 시점과 다르면(그사이
  // projectId가 바뀌어 load가 다시 호출됨) 이전 프로젝트의 응답으로 최신 상태를
  // 덮어쓰지 않도록 무시한다.
  const generationRef = useRef(0);

  const load = useCallback(() => {
    const generation = ++generationRef.current;
    if (projectId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return Promise.resolve();
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    return fetchWorkloadScore(projectId)
      .then(result => {
        if (generation === generationRef.current) setData(result);
      })
      .catch((err: Error) => {
        if (generation === generationRef.current) setError(err.message);
      })
      .finally(() => {
        if (generation === generationRef.current) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
