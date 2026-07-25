import { useEffect, useState } from "react";
import { fetchPendingApprovalTasks, DEMO_PROJECT_ID } from "../../../board/libs/utils/taskApi";

/** 완료 승인 대기 건수. 조회 실패는 뱃지를 숨기는 정도로만 처리하고 조용히 무시한다. */
export function usePendingApprovalCount(projectId: number | null, enabled: boolean = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    fetchPendingApprovalTasks(projectId ?? DEMO_PROJECT_ID)
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
