import { Sparkles } from "lucide-react";
import { useAiInsight } from "../libs/hooks/useAiInsight";
import { openAIAssistant } from "../libs/utils/openAIAssistant";
import { AIBox } from "./AIBox";

interface AiInsightBoxProps {
  projectId: number | null | undefined;
  prompt: string;
  ready: boolean;
  fallbackText: string;
  actionLabel?: string;
  variant?: "card" | "banner";
  /** LLM 원문 답변을 화면에 보여줄 문구로 감싼다 (예: "{이름}님의 {업무}이 지연 위험입니다. {답변}").
   * 기본값은 LLM 답변을 그대로 보여준다. */
  formatAnswer?: (answer: string) => string;
}

/** 여러 화면의 "AI 추천 액션" 섹션이 공유하는 컴포넌트. projectId/ready가 준비되면
 * prompt로 RAG 질의를 한 번 자동 실행해 그 답변을 보여주고, 버튼을 누르면 같은 질문을
 * 들고 AI 어시스턴트 패널을 연다. */
export function AiInsightBox({
  projectId,
  prompt,
  ready,
  fallbackText,
  actionLabel = "AI에게 질문",
  variant = "card",
  formatAnswer = answer => answer,
}: AiInsightBoxProps) {
  const { text, loading, error } = useAiInsight(projectId, prompt, ready);
  const displayText = loading
    ? "AI가 답변을 준비하고 있습니다..."
    : !error && text
      ? formatAnswer(text)
      : fallbackText;

  if (variant === "banner") {
    return (
      <div className="rounded-xl p-4 flex items-center gap-3 text-white" style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/20">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">AI 추천 액션</div>
          <div className="text-xs text-white/85 mt-0.5">{displayText}</div>
        </div>
        <button
          onClick={() => openAIAssistant(prompt)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 bg-white/20 hover:bg-white/30 transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    );
  }

  return <AIBox text={displayText} onAsk={() => openAIAssistant(prompt)} actionLabel={actionLabel} />;
}
