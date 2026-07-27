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

  // 요청 세대(generation) 번호 - 응답이 도착했을 때 이 값이 요청 시점과 다르면(그사이
  // projectId가 바뀌어 refetch가 다시 호출됨) 이전 프로젝트의 응답으로 최신 상태를
  // 덮어쓰지 않도록 무시한다. cleanup 함수(() => void)를 반환하면 호출부의
  // `await refetch()`가 fetch 완료를 기다리지 못하므로, 취소는 세대 번호 비교로 하고
  // refetch 자체는 반드시 Promise를 반환한다.
  const generationRef = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;
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
