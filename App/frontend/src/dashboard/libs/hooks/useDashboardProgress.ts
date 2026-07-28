import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueDelayRiskRefresh, fetchDashboardProgress, fetchDelayRiskRefreshStatus } from "../utils/dashboardApi";
import { pollDashboardAiJobUntilDone } from "../utils/pollDashboardAiJob";
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
    return fetchDashboardProgress(projectId)
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

  // 재분석 요청은 Redis Queue에 적재될 뿐 즉시 끝나지 않으므로, jobId를 받아 완료될 때까지
  // 폴링한 뒤에야 최신 진행률 상세를 다시 불러온다.
  const runDelayRiskAnalysis = useCallback(() => {
    if (projectId == null) {
      setError("프로젝트를 먼저 선택해주세요.");
      return Promise.resolve();
    }
    setRefreshing(true);
    setError(null);
    return enqueueDelayRiskRefresh(projectId)
      .then(job => pollDashboardAiJobUntilDone(() => fetchDelayRiskRefreshStatus(projectId, job.jobId)))
      .then(() => fetchDashboardProgress(projectId))
      .then(result => setData(result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [projectId]);

  return { data, loading, refreshing, error, refetch: load, runDelayRiskAnalysis };
}
