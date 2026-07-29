interface AIBoxProps {
  text: string;
  onAsk?: () => void;
  actionLabel?: string;
}

// "AI 추천 액션" / "AI에게 질문" 기능 미사용 처리 - 렌더링하지 않는다(관련 코드는 주석 처리해서 보존).
export function AIBox(_props: AIBoxProps) {
  return null;
}

// import { Sparkles } from "lucide-react";
//
// export function AIBox({ text, onAsk, actionLabel = "AI에게 질문" }: AIBoxProps) {
//   return (
//     <div className="rounded-xl p-4 flex items-start gap-3 border border-purple-200" style={{ background: "rgba(112,72,232,0.05)" }}>
//       <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
//         style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
//         <Sparkles className="w-3.5 h-3.5 text-white" />
//       </div>
//       <div className="flex-1 min-w-0">
//         <div className="text-xs font-semibold text-foreground mb-0.5">AI 추천 액션</div>
//         <div className="text-xs text-muted-foreground leading-relaxed">{text}</div>
//       </div>
//       {onAsk && (
//         <button onClick={onAsk}
//           className="text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80"
//           style={{ background: "rgba(112,72,232,0.15)", color: "#7048E8" }}>
//           {actionLabel}
//         </button>
//       )}
//     </div>
//   );
// }
