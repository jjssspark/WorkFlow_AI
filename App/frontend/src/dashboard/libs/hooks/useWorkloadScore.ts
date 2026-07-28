import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueWorkloadScoreRefresh, fetchWorkloadScore, fetchWorkloadScoreRefreshStatus } from "../utils/workloadScoreApi";
import { pollDashboardAiJobUntilDone } from "../utils/pollDashboardAiJob";
import type { WorkloadScoreResult } from "../utils/workloadScoreApi";

export function useWorkloadScore(projectId: string | number | null | undefined) {
  const [data, setData] = useState<WorkloadScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  // GET은 이제 Redis에 캐시된 마지막 계산 결과만 돌려주므로, 새로 계산하려면 재계산 작업을
  // Redis Queue에 적재하고 완료될 때까지 폴링한 뒤 캐시를 다시 읽어와야 한다.
  const refreshWorkloadScore = useCallback(() => {
    if (projectId == null) {
      setError("프로젝트를 먼저 선택해주세요.");
      return Promise.resolve();
    }
    setRefreshing(true);
    setError(null);
    return enqueueWorkloadScoreRefresh(projectId)
      .then(job => pollDashboardAiJobUntilDone(() => fetchWorkloadScoreRefreshStatus(projectId, job.jobId)))
      .then(() => load())
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [projectId, load]);

  return { data, loading, refreshing, error, refetch: load, refreshWorkloadScore };
}
