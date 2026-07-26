import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, Send } from "lucide-react";
import { buildChatInit, QUICK_QUESTIONS } from "../libs/mock/chat";
import { useRagQuery } from "../libs/hooks/useRagQuery";
import { useAuth } from "../../global/hooks/useAuth";
import type { ChatMsg, RagSource } from "../libs/types/chat";
import type { ActionCard } from "../libs/types/command";
import type { OpenAIAssistantEventDetail } from "../libs/utils/openAIAssistant";
import { ConfirmActionCard } from "../components/ConfirmActionCard";
import type { ExecutionResult } from "../libs/utils/actionExecutor";
import { confirmAction } from "../libs/utils/confirmAction";
import { shouldShowSources } from "../libs/utils/sourceVisibility";

const NO_PROJECT_MESSAGE = "아직 연결된 프로젝트가 없습니다. 프로젝트를 만들고 회의록을 업로드한 뒤 다시 질문해주세요.";

const CHAT_SESSION_KEY_PREFIX = "ai-assistant-chat-session";
const CHAT_SESSION_TTL_MS = 5 * 60 * 1000;

type ChatSession = { messages: ChatMsg[]; savedAt: number };

function buildSessionKey(userId: number | undefined, projectId: number | null): string {
  return `${CHAT_SESSION_KEY_PREFIX}:${userId ?? "anon"}:${projectId ?? "none"}`;
}

// 타입 가드와 화면 라벨이 같은 목록을 보게 해서, 출처 종류가 늘 때 한쪽만 고쳐
// 세션이 폐기되는 일을 막는다.
const SOURCE_TYPE_LABELS: Record<RagSource["sourceType"], string> = {
  meeting: "회의록",
  task: "업무",
  action_item: "액션아이템",
};

function isRagSource(value: unknown): value is RagSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (!SOURCE_TYPE_LABELS[source.sourceType as RagSource["sourceType"]]) return false;
  if (typeof source.sourceId !== "number") return false;
  if (typeof source.contentSnippet !== "string") return false;
  if (typeof source.similarity !== "number") return false;
  return true;
}

function isChatMsg(value: unknown): value is ChatMsg {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;
  if (msg.role !== "user" && msg.role !== "assistant") return false;
  if (typeof msg.content !== "string") return false;
  if (msg.sources !== undefined && (!Array.isArray(msg.sources) || !msg.sources.every(isRagSource))) return false;
  // 세션 복원 시 깨진 카드가 들어오면 조용히 무시한다(카드는 있거나, 객체이거나 둘 중 하나).
  if (msg.card !== undefined && (typeof msg.card !== "object" || msg.card === null)) return false;
  if (msg.threadId !== undefined && typeof msg.threadId !== "string") return false;
  return true;
}

function isChatSession(value: unknown): value is ChatSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  if (typeof session.savedAt !== "number") return false;
  return Array.isArray(session.messages) && session.messages.every(isChatMsg);
}

function safeRemoveItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // 스토리지 접근이 제한된 환경(비공개 모드 등) - 삭제 실패는 무시한다.
  }
}

function loadSavedMessages(key: string): ChatMsg[] | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const now = Date.now();
    if (!isChatSession(parsed) || parsed.savedAt > now || now - parsed.savedAt > CHAT_SESSION_TTL_MS) {
      safeRemoveItem(key);
      return null;
    }
    return parsed.messages;
  } catch {
    safeRemoveItem(key);
    return null;
  }
}

function saveSession(key: string, messages: ChatMsg[]): void {
  const session: ChatSession = { messages, savedAt: Date.now() };
  try {
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // sessionStorage 용량 초과·비공개 모드 제한 등 - 대화 저장은 best-effort라 실패해도 무시한다.
  }
}

interface AIAssistantProps {
  onClose: () => void;
  pendingQuestion?: OpenAIAssistantEventDetail | null;
  // 닫혀 있어도 언마운트하지 않고 숨기기만 한다. 언마운트하면 아래 정리 함수가 진행 중인
  // 요청을 끊어 "질문하고 창을 닫으면 답변이 영영 오지 않는" 상태가 된다.
  isOpen?: boolean;
  // 닫혀 있는 동안 답변이 도착했음을 알린다. 호출부가 버튼에 표시를 띄우는 데 쓴다.
  onAnswerWhileClosed?: () => void;
}

export function AIAssistant({
  onClose,
  pendingQuestion,
  isOpen = true,
  onAnswerWhileClosed,
}: AIAssistantProps) {
  const { user, currentProjectId, currentProject } = useAuth();
  const sessionKey = useMemo(() => buildSessionKey(user?.id, currentProjectId), [user?.id, currentProjectId]);
  const sessionKeyRef = useRef(sessionKey);
  const [messages, setMessages] = useState<ChatMsg[]>(
    () => loadSavedMessages(sessionKey) ?? buildChatInit(user?.name ?? "회원")
  );
  const [input, setInput] = useState("");
  const { status, answer, error, ask, cancel } = useRagQuery();
  const loading = status === "loading";
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // 응답을 요청한 시점의 세션 키. 응답이 도착했을 때 이 값이 현재 세션 키와 다르면
  // (그사이 계정/프로젝트가 전환됨) 다른 세션의 대화창에 답변이 섞이지 않도록 무시한다.
  const askedForKeyRef = useRef<string | null>(null);
  const handledRequestIdRef = useRef<number | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  // 같은 카드(step_id)를 연타·재시도로 두 번 실행하지 않도록 진행 중인 step을 기억한다.
  const pendingStepIdRef = useRef<string | null>(null);
  // 쓰기는 성공했으나 resume 전달이 실패한 실행 결과. 재시도 시 재실행 없이 resume만 다시 보낸다.
  const executedResultsRef = useRef<Map<string, ExecutionResult>>(new Map());

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 대화 도중 사용자·프로젝트가 바뀌면(계정 전환, 프로젝트 전환) 진행 중이던 요청을 취소하고
  // 이전 세션을 그 키로 저장한 뒤, 새 키에 해당하는 대화로 교체해 다른 사용자/프로젝트의
  // 대화·출처가 섞이지 않게 한다.
  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    cancel();
    saveSession(sessionKeyRef.current, messagesRef.current);
    sessionKeyRef.current = sessionKey;
    setMessages(loadSavedMessages(sessionKey) ?? buildChatInit(user?.name ?? "회원"));
  }, [sessionKey, user?.name, cancel]);

  useEffect(() => {
    return () => {
      cancel();
      saveSession(sessionKeyRef.current, messagesRef.current);
    };
  }, [cancel]);

  // isOpen을 아래 효과의 의존성에 넣으면 창을 열 때 효과가 다시 돌아 같은 답변이 한 번 더
  // 추가된다. 값은 필요하지만 재실행 트리거로는 쓰면 안 되므로 ref로 읽는다.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const onAnswerWhileClosedRef = useRef(onAnswerWhileClosed);
  onAnswerWhileClosedRef.current = onAnswerWhileClosed;

  useEffect(() => {
    if (askedForKeyRef.current !== sessionKey) return;
    if (status === "success" && answer) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: answer.content,
          sources: answer.sources,
          ...(answer.card ? { card: answer.card, threadId: answer.threadId ?? undefined } : {}),
        },
      ]);
    }
    if (status === "error" && error) {
      setMessages(prev => [...prev, { role: "assistant", content: error }]);
    }
    if ((status === "success" && answer) || (status === "error" && error)) {
      if (!isOpenRef.current) onAnswerWhileClosedRef.current?.();
    }
  }, [status, answer, error, sessionKey]);

  const send = useCallback((text: string) => {
    if (!text.trim() || loading) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    if (currentProjectId == null) {
      setMessages(prev => [...prev, { role: "assistant", content: NO_PROJECT_MESSAGE }]);
      setTimeout(() => setInput(""), 0);
      return;
    }
    askedForKeyRef.current = sessionKey;
    // 후속 질문 재작성용 대화 기록. buildChatInit이 만든 첫 인사말(index 0)은 대화가 아니므로
    // 제외하고, 방금 추가한 사용자 질문은 question으로 따로 넘어가므로 여기엔 포함하지 않는다
    // (setMessages는 비동기라 messagesRef.current에는 아직 반영되지 않았다). 6개 상한은 queryRag가 건다.
    ask(currentProjectId, text, messagesRef.current.slice(1));
    // 한글 등 IME 조합 완료 이벤트가 keydown 이후 뒤늦게 들어와 입력창을 다시 채우는 것을 피하기 위해
    // 조합 이벤트가 먼저 처리되도록 한 틱 미뤄서 비운다.
    setTimeout(() => setInput(""), 0);
  }, [ask, currentProjectId, loading, sessionKey]);

  useEffect(() => {
    const question = pendingQuestion?.question?.trim();
    if (!question || loading || handledRequestIdRef.current === pendingQuestion.requestId) return;
    handledRequestIdRef.current = pendingQuestion.requestId;
    send(question);
  }, [loading, pendingQuestion, send]);

  const clearCard = useCallback((stepId: string) => {
    setMessages(prev =>
      prev.map(m => (m.card?.stepId === stepId ? { ...m, card: undefined, threadId: undefined } : m))
    );
  }, []);

  const confirmCard = useCallback(async (card: ActionCard, threadId: string) => {
    // 진행 중인 같은 step은 연타를 막는다. finally에서 풀리므로 실패 후 재시도는 허용된다.
    if (currentProjectId == null || pendingStepIdRef.current === card.stepId) return;
    pendingStepIdRef.current = card.stepId;
    setCardBusy(true);
    try {
      // 실제 쓰기는 기존 업무보드 API로만 나가고(AI 전용 쓰기 경로 없음), 이미 실행된
      // 단계는 재실행하지 않고 resume만 다시 보낸다(중복 쓰기 방지).
      const outcome = await confirmAction(card, threadId, currentProjectId, executedResultsRef.current);
      if (outcome.status === "resume_failed") {
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: "결과를 전달하지 못했습니다. 다시 시도하거나 업무 보드에서 확인해주세요." },
        ]);
        return;
      }
      const next = outcome.answer;
      setMessages(prev => [
        ...prev.map(m => (m.card?.stepId === card.stepId ? { ...m, card: undefined, threadId: undefined } : m)),
        {
          role: "assistant",
          content: next.content,
          ...(next.card ? { card: next.card, threadId: next.threadId ?? undefined } : {}),
        },
      ]);
    } finally {
      pendingStepIdRef.current = null;
      setCardBusy(false);
    }
  }, [currentProjectId]);

  const cancelCard = useCallback((card: ActionCard) => {
    // 서버에 알릴 필요는 없다 - 체크포인트는 TTL로 만료된다.
    executedResultsRef.current.delete(card.stepId);
    clearCard(card.stepId);
    setMessages(prev => [...prev, { role: "assistant", content: "취소했습니다." }]);
  }, [clearCard]);

  return (
    // 숨김은 인라인 display로 건다. 루트가 flex라 Tailwind의 hidden 클래스를 얹으면
    // 두 display 유틸리티의 우선순위 싸움이 되어 빌드 순서에 따라 결과가 달라진다.
    // inert/aria-hidden까지 걸어야 닫힌 패널의 입력창이 Tab 순서에 남지 않는다.
    <div className="fixed right-0 top-0 h-full w-[380px] shadow-2xl flex flex-col z-50"
      aria-hidden={!isOpen || undefined}
      inert={!isOpen || undefined}
      style={{ background: "#FFFFFF", fontFamily: "'Inter', 'Noto Sans KR', sans-serif", borderLeft: "1px solid var(--border)", ...(isOpen ? {} : { display: "none" }) }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border" style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">AI 어시스턴트</div>
            <div className="text-[10px] text-purple-200">{currentProject?.projectTitle ?? "프로젝트를 선택하세요"}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="AI 어시스턴트 닫기" className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Quick questions */}
      <div className="px-4 py-3 border-b border-border bg-secondary/40 flex gap-2 overflow-x-auto scrollbar-hide">
        {QUICK_QUESTIONS.map(q => (
          <button key={q} onClick={() => send(q)}
            className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors text-muted-foreground whitespace-nowrap">
            {q}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mr-2 mt-0.5" style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}>
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            <div className="max-w-[85%]">
              <div className={`text-sm rounded-2xl px-4 py-3 whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "text-white rounded-br-sm" : "text-foreground bg-secondary rounded-bl-sm"}`}
                style={m.role === "user" ? { background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" } : {}}>
                {m.content}
              </div>
              {m.sources && shouldShowSources(m.content, m.sources) && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {m.sources.map((s, si) => (
                    <span key={si} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      출처: {SOURCE_TYPE_LABELS[s.sourceType]} #{s.sourceId}
                    </span>
                  ))}
                </div>
              )}
              {m.card && m.threadId && (
                <ConfirmActionCard
                  card={m.card}
                  disabled={cardBusy}
                  onConfirm={() => confirmCard(m.card!, m.threadId!)}
                  onCancel={() => cancelCard(m.card!)}
                />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mr-2" style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}>
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              {[0, 1, 2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-xl border border-border bg-input-background px-3 py-2.5">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="프로젝트에 대해 무엇이든 물어보세요..."
              rows={1}
              className="w-full text-sm bg-transparent outline-none resize-none text-foreground placeholder-muted-foreground"
            />
          </div>
          <button onClick={() => send(input)} disabled={!input.trim() || loading} aria-label="전송"
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-40 text-white"
            style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}>
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground text-center mt-2">회의록·To-Do·GitHub 기록 기반으로 답변합니다</div>
      </div>
    </div>
  );
}
