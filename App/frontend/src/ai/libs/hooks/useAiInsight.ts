import { useEffect, useRef } from "react";
import { useRagQuery } from "./useRagQuery";

/** 동시에 진행 중인 useAiInsight 자동 질의 개수 상한.
 * BlockersPage처럼 useAiInsight를 쓰는 카드가 목록으로 여러 개 렌더될 수 있어,
 * ready가 한 번에 true가 되면 카드 수만큼 LLM 호출이 동시에 나가 성능/비용/레이트리밋
 * 위험이 생긴다. 모든 useAiInsight 인스턴스가 이 전역 카운터를 공유해 동시 실행 수를
 * 제한하고, 순서를 기다리는 요청은 대기열에 넣어 앞선 요청이 끝나면 순서대로 실행한다. */
const MAX_CONCURRENT_INSIGHT_REQUESTS = 2;
let activeInsightRequests = 0;
const pendingInsightRequests: Array<() => void> = [];

function runWhenSlotAvailable(run: () => void): () => void {
  let cancelled = false;
  const attempt = () => {
    if (cancelled) return;
    if (activeInsightRequests >= MAX_CONCURRENT_INSIGHT_REQUESTS) {
      pendingInsightRequests.push(attempt);
      return;
    }
    activeInsightRequests += 1;
    run();
  };
  attempt();
  return () => {
    cancelled = true;
    const queueIndex = pendingInsightRequests.indexOf(attempt);
    if (queueIndex !== -1) pendingInsightRequests.splice(queueIndex, 1);
  };
}

function releaseInsightSlot() {
  activeInsightRequests = Math.max(0, activeInsightRequests - 1);
  const next = pendingInsightRequests.shift();
  if (next) next();
}

/** 테스트 전용 - 모듈 레벨 동시성 상태를 초기화한다.
 * activeInsightRequests/pendingInsightRequests는 모든 useAiInsight 인스턴스가 공유하는
 * 전역 상태라, 이전 테스트에서 resolve되지 않은 요청이 남아 있으면 다음 테스트의 동시
 * 실행 슬롯을 오염시킨다. */
export function __resetInsightConcurrencyStateForTests() {
  activeInsightRequests = 0;
  pendingInsightRequests.length = 0;
}

/** 페이지에 상주하는 "AI 추천 액션" 문구를 RAG 질의로 한 번만 자동 채운다.
 * ready(=페이지 데이터 로딩 완료)가 true가 된 시점에 prompt로 한 번만 질의하고,
 * 이후 prompt가 바뀌어도 다시 묻지 않는다 — 페이지 방문마다 LLM 호출이 반복되는
 * 것을 막기 위함이며, 최신 답변이 필요하면 사용자가 "AI에게 질문" 버튼으로
 * AI 어시스턴트 패널에서 다시 물어볼 수 있다.
 *
 * 동일 페이지에 이 훅을 쓰는 인스턴스가 여러 개(예: 블로커 카드마다) 동시에 ready가 되면
 * MAX_CONCURRENT_INSIGHT_REQUESTS개까지만 즉시 실행하고 나머지는 대기열에서 순서를
 * 기다린다(요청 자체를 취소하지는 않는다 — 언마운트 시에만 대기열에서 제거). */
export function useAiInsight(projectId: number | null | undefined, prompt: string, ready: boolean) {
  const { status, answer, error, ask } = useRagQuery();
  // 프로젝트를 전환한 뒤에도 이전 프로젝트의 답변을 재사용하지 않도록,
  // 마지막으로 질의한 프로젝트를 기록한다. 같은 프로젝트 안에서 prompt가
  // 다시 계산되는 것만으로는 재질의하지 않아 자동 호출 비용을 제한한다.
  const askedProjectIdRef = useRef<number | null>(null);
  // React StrictMode는 effect를 mount → cleanup → mount로 두 번 실행한다. 대기열에서
  // 순서를 기다리는 동안 첫 mount가 cleanup되면, queuedRef를 true로 남겨두는 방식으로는
  // 두 번째 mount가 "이미 대기열에 있다"고 착각해 재등록을 건너뛰어 요청이 영구 누락된다.
  // 그래서 이 값을 boolean이 아니라 "대기열 취소 함수"로 들고 있다가, cleanup에서 그
  // 취소 함수를 실행함과 동시에 null로 되돌려 다음 mount가 다시 등록할 수 있게 한다.
  const cancelQueueEntryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ready || projectId == null || askedProjectIdRef.current === projectId || cancelQueueEntryRef.current) return;
    cancelQueueEntryRef.current = runWhenSlotAvailable(() => {
      askedProjectIdRef.current = projectId;
      let result: unknown;
      try {
        result = ask(projectId, prompt);
      } catch {
        // ask가 (정상적으로는 일어나지 않아야 하지만) 동기적으로 예외를 던지는 경우까지
        // 대비한다 - 여기서 슬롯을 해제하지 않으면 대기열 전체가 멈춘다.
        releaseInsightSlot();
        return;
      }
      Promise.resolve(result).finally(releaseInsightSlot);
    });
    return () => {
      cancelQueueEntryRef.current?.();
      cancelQueueEntryRef.current = null;
    };
    // prompt/ask는 매 렌더 계산값이라 의존성에 넣지 않는다 — askedProjectIdRef가 프로젝트별 최초 1회만
    // 실행되게 막고, cancelQueueEntryRef는 대기열 등록 여부 자체를 추적한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projectId]);

  return {
    text: answer?.content ?? null,
    loading:
      status === "loading" ||
      (ready && projectId != null && askedProjectIdRef.current !== projectId),
    error,
  };
}
