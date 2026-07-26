export const OPEN_AI_ASSISTANT_EVENT = "workflow-ai:open-ai-assistant";

export interface OpenAIAssistantEventDetail {
  question?: string;
  requestId: number;
}

// Date.now() + Math.random()은 충돌한다. Date.now()가 1.78e12라 double의 ulp가 약 1/2048이고,
// 더해진 소수부는 그 정밀도로 반올림되어 서로 다른 난수가 같은 값이 될 수 있다(실측: CI 1회 재현).
// 충돌하면 AIAssistant가 handledRequestIdRef 비교에서 같은 요청으로 보고 두 번째 질문을 버린다.
// 단조 증가 카운터는 같은 세션 안에서 절대 충돌하지 않는다.
let requestSequence = 0;

/** AI 어시스턴트 패널을 열고, question이 있으면 자동으로 질문을 전송하게 한다.
 * requestId는 동일한 문구를 다시 요청해도 AIAssistant의 useEffect가 항상 반응하도록
 * 매 호출마다 새 값을 부여한다 (question 텍스트만으로는 dependency가 안 바뀔 수 있음). */
export function openAIAssistant(question?: string): void {
  const detail: OpenAIAssistantEventDetail = { question, requestId: ++requestSequence };
  window.dispatchEvent(new CustomEvent<OpenAIAssistantEventDetail>(OPEN_AI_ASSISTANT_EVENT, { detail }));
}
