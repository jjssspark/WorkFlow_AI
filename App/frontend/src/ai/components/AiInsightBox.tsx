import { Sparkles } from "lucide-react";
import { useAiInsight } from "../libs/hooks/useAiInsight";
import { openAIAssistant } from "../libs/utils/openAIAssistant";
import { AIBox } from "./AIBox";

const FALLBACK_TEXT = "AI Assistant가 응답하지 않습니다.";

interface AiInsightBoxProps {
  projectId: number | null | undefined;
  prompt: string;
  ready: boolean;
  fallbackText?: string;
  actionLabel?: string;
  variant?: "card" | "banner";
  /** 
   * LLM 원문 답변을 화면에 보여줄 문구로 감싼다 
   * (예: "{이름}님의 {업무}이 지연 위험입니다. {답변}").
   * 기본값은 LLM 답변을 그대로 보여준다. 
   */
  formatAnswer?: (answer: string) => string;
}

/** 
 * 여러 화면의 "AI 추천 액션" 섹션이 공유하는 컴포넌트. projectId/ready가 준비되면
 * prompt로 RAG 질의를 한 번 자동 실행해 그 답변을 보여주고, 버튼을 누르면 같은 질문을
 * 들고 AI 어시스턴트 패널을 연다. 
 */
export function AiInsightBox({
  projectId,
  prompt,
  ready,
  actionLabel = "AI에게 질문",
  variant = "card",
  fallbackText = FALLBACK_TEXT,
  formatAnswer = (answer) => answer,
}: AiInsightBoxProps) {
  const { text, loading, error } = useAiInsight(projectId, prompt, ready);
  
  const hasAnswer = !loading && !error && !!text;
  
  // 1. 상수 FALLBACK_TEXT 대신 prop으로 받은 fallbackText를 사용하도록 수정했습니다.
  // 2. 가독성을 위해 중첩 삼항 연산자 대신 일반 조건문이나 명확한 분기를 사용하는 것도 좋습니다.
  const displayText = loading
    ? "AI가 답변을 준비하고 있습니다..."
    : hasAnswer
      ? formatAnswer(text)
      : fallbackText;

  // 답변이 이미 나와 있으면 "자세히"는 같은 질문을 반복하지 않고, 방금 보여준 답변 자체를
  // 더 자세히 설명해달라는 후속 질문을 들고 AI 어시스턴트를 연다.
  const askAgain = () => {
    const nextPrompt = hasAnswer 
      ? `방금 "AI 추천 액션"에서 보여준 다음 내용을 더 자세히 설명해줘: "${displayText}"` 
      : prompt;
      
    openAIAssistant(nextPrompt);
  };

  if (variant === "banner") {
    return (
      // 인라인 스타일 대신 Tailwind의 bg-gradient-to-br 유틸리티를 적용했습니다.
      <div className="rounded-xl p-4 flex items-center gap-3 text-white bg-gradient-to-br from-[#7048E8] to-[#4F6EF7]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/20">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">AI 추천 액션</div>
          <div className="text-xs text-white/85 mt-0.5">{displayText}</div>
        </div>
        <button
          onClick={askAgain}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 bg-white/20 hover:bg-white/30 transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    );
  }

  return <AIBox text={displayText} onAsk={askAgain} actionLabel={actionLabel} />;
}