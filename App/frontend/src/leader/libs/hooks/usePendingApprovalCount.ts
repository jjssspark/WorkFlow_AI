import { useEffect, useState } from "react";
import { fetchPendingApprovalTasks } from "../../../board/libs/utils/taskApi";

/**
 * 완료 승인 대기 건수. 조회 실패는 뱃지를 숨기는 정도로만 처리하고 조용히 무시한다.
 * projectId나 enabled가 바뀌면 새 값이 오기 전까지 이전 프로젝트의 건수가 잠깐 보이지
 * 않도록 즉시 0으로 초기화한다. projectId가 없으면(프로젝트 컨텍스트 없음) 조회하지 않는다 —
 * 데모 프로젝트로 대신 조회하면 엉뚱한 뱃지가 뜬다.
 */
export function usePendingApprovalCount(projectId: number | null, enabled: boolean = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!enabled || projectId === null) {
      return;
    }
    let cancelled = false;
    fetchPendingApprovalTasks(projectId)
      .then((tasks) => {
        if (!cancelled) setCount(tasks.length);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return count;
}
