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

  // 요청 세대(generation) 번호 - 응답이 도착했을 때 이 값이 요청 시점과 다르면(그사이
  // projectId가 바뀌어 refetch가 다시 호출됨) 이전 프로젝트의 응답으로 최신 상태를
  // 덮어쓰지 않도록 무시한다. cleanup 함수(() => void)를 반환하면 호출부의
  // `await refetch()`가 fetch 완료를 기다리지 못하므로, 취소는 세대 번호 비교로 하고
  // refetch 자체는 반드시 Promise를 반환한다.
  const generationRef = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;
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
      if (generation !== generationRef.current) return;
      setData(result);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError((err as Error).message);
    } finally {
      if (generation === generationRef.current) {
        hasLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
