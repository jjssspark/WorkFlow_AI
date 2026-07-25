import { useEffect, useState } from "react";
import { fetchPendingApprovalTasks } from "../../../board/libs/utils/taskApi";

/** 완료 승인 대기 건수. 조회 실패는 뱃지를 숨기는 정도로만 처리하고 조용히 무시한다. */
export function usePendingApprovalCount(projectId: number | null, enabled: boolean = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // projectId가 없을 때 데모 프로젝트로 폴백하면 남의 프로젝트 승인 건수를 뱃지에 띄운다.
    // 조회할 프로젝트가 정해지기 전에는 아무것도 세지 않는다.
    if (!enabled || projectId === null) {
      setCount(0);
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
