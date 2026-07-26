import type { RagSource } from "../types/chat";

// 서버가 근거를 못 찾았을 때 내는 고정 문구. generation_service._SYSTEM_PROMPT와 짝이라
// 한쪽 문구만 바꾸면 이 판정이 조용히 죽는다(칩이 다시 뜬다).
const NO_EVIDENCE_PREFIX = "근거 없음";

/**
 * "근거 없음"이라고 답하면서 출처 칩이 5개 떠 있는 모순 화면을 막는다.
 * 자료가 있다고 화면이 말하는데 답변은 없다고 하면 사용자가 답변 전체를 못 믿게 된다.
 *
 * 문구를 포함이 아니라 앞부분으로 판정한다. 정상 답변이 본문 중간에 "근거 없음"을
 * 언급할 수 있는데, 그때까지 출처를 감추면 멀쩡한 근거를 숨기게 된다.
 */
export function shouldShowSources(answer: string, sources: RagSource[]): boolean {
  if (sources.length === 0) return false;
  return !answer.trim().startsWith(NO_EVIDENCE_PREFIX);
}
