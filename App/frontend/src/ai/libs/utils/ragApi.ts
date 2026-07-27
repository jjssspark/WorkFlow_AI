import type { RagSource } from "../types/chat";
import { apiFetch } from "../../../global/api/apiClient";

// 재작성 프롬프트에 실리는 대화 기록 상한. Spring RagController.MAX_HISTORY_MESSAGES와 같은 값이라야
// 프론트에서 자른 크기가 서버 검증(초과 시 400 INVALID_HISTORY)에 걸리지 않는다.
export const MAX_HISTORY_MESSAGES = 6;

// 메시지 1개당 글자 수 상한. Spring RagController.MAX_HISTORY_CONTENT_LENGTH와 같은 값이라야
// 긴 질문/답변이 히스토리로 재전송될 때 400 INVALID_HISTORY로 대화 전체가 끊기지 않는다.
export const MAX_HISTORY_CONTENT_LENGTH = 1000;

// 질문 길이 상한. Spring RagController.MAX_QUESTION_LENGTH와 같은 값이라야 입력 단계에서 막힌 것만
// 서버로 나가고, 400 INVALID_QUESTION이 사용자에게 그대로 노출되지 않는다.
// 여기서 question을 자르지는 않는다 - 히스토리와 달리 질문을 몰래 truncate하면 사용자가 하지 않은
// 질문에 답이 달린다. 자르는 대신 입력창에서 애초에 초과 입력을 막는다.
export const MAX_QUESTION_LENGTH = 1000;

// 후속 질문 재작성에 필요한 최소 필드만. sources 등 부가 필드는 서버로 보내지 않는다.
export interface RagHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// Spring 응답은 FastAPI 스키마를 그대로 통과시키므로 snake_case로 온다 (source_type 등).
interface RawRagSource {
  source_type: "meeting" | "task" | "action_item";
  source_id: number;
  content_snippet: string;
  similarity: number;
}

interface RawRagQueryResult {
  answer: string;
  sources: RawRagSource[];
}

interface RagQueryResult {
  answer: string;
  sources: RagSource[];
}

export async function queryRag(
  projectId: number,
  question: string,
  history: readonly RagHistoryMessage[] = [],
  signal?: AbortSignal
): Promise<RagQueryResult> {
  const trimmedHistory = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map(({ role, content }) => ({ role, content: content.slice(0, MAX_HISTORY_CONTENT_LENGTH) }));
  const data = await apiFetch<RawRagQueryResult>("/ai/rag/query", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, question, history: trimmedHistory }),
    signal,
  });
  return {
    answer: data.answer,
    sources: data.sources.map(s => ({
      sourceType: s.source_type,
      sourceId: s.source_id,
      contentSnippet: s.content_snippet,
      similarity: s.similarity,
    })),
  };
}
