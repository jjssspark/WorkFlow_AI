import { Sparkles } from "lucide-react";
import { useAiInsight } from "../libs/hooks/useAiInsight";
import { openAIAssistant } from "../libs/utils/openAIAssistant";
import { AIBox } from "./AIBox";

interface AiInsightBoxProps {
  projectId: number | null | undefined;
  prompt: string;
  ready: boolean;
  title?: string;
  fallbackText?: string;
  errorText?: string;
  actionLabel?: string;
  variant?: "card" | "banner";
  formatAnswer?: (answer: string) => string;
}

const FALLBACK_TEXT = "AI Assistant가 응답하지 않습니다.";
const ERROR_TEXT = "AI 분석을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";

/**
 * 페이지 데이터가 준비되면 현재 프로젝트의 LLM 컨텍스트로 한 번 질의하고,
 * 이어지는 질문은 전역 AI 어시스턴트 패널에서 계속할 수 있게 연결한다.
 */
export function AiInsightBox({
  projectId,
  prompt,
  ready,
  title = "AI 추천 액션",
  actionLabel = "AI에게 질문",
  variant = "card",
  fallbackText = FALLBACK_TEXT,
  errorText = ERROR_TEXT,
  formatAnswer = answer => answer,
}: AiInsightBoxProps) {
  const { text, loading, error } = useAiInsight(projectId, prompt, ready);
  const hasAnswer = !loading && !error && !!text;
  const displayText = loading
    ? "AI가 답변을 준비하고 있습니다..."
    : error
      ? errorText
      : hasAnswer
        ? formatAnswer(text)
        : fallbackText;

  const askAgain = () => {
    const nextPrompt = hasAnswer
      ? `방금 "${title}"에서 보여준 다음 내용을 더 자세히 설명해줘: "${displayText}"`
      : prompt;
    openAIAssistant(nextPrompt);
  };

  if (variant === "banner") {
    return (
      <div className="rounded-xl p-4 flex items-center gap-3 text-white bg-gradient-to-br from-[#7048E8] to-[#4F6EF7]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/20">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-white/85 mt-0.5 whitespace-pre-line">{displayText}</div>
        </div>
        <button
          type="button"
          onClick={askAgain}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 bg-white/20 hover:bg-white/30 transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    );
  }

  return <AIBox title={title} text={displayText} onAsk={askAgain} actionLabel={actionLabel} />;
}
