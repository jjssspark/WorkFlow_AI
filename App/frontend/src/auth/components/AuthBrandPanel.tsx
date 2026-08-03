import { FileAudio, Sparkles, Shield } from "lucide-react";

export function AuthBrandPanel() {
  return (
    <div className="relative w-full lg:w-[42%] min-h-[260px] lg:min-h-screen flex flex-col justify-between p-6 sm:p-8 lg:p-10 overflow-hidden" style={{ background: "linear-gradient(145deg, #111827 0%, #1A2035 50%, #1E2D5A 100%)" }}>
      {/* decorative blobs */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #7048E8, transparent)" }} />
      <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #4F6EF7, transparent)" }} />
      <div className="absolute top-1/2 right-8 w-40 h-40 rounded-full opacity-5" style={{ background: "radial-gradient(circle, #10B981, transparent)" }} />

      {/* logo */}
      <div>
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-base" style={{ background: "linear-gradient(135deg, #7048E8, #4F6EF7)" }}>
            WF
          </div>
          <div>
            <div className="text-white font-bold text-lg leading-none">WorkFlow</div>
            <div className="text-xs font-medium mt-0.5" style={{ color: "#A78BFA" }}>AI Powered</div>
          </div>
        </div>

        <h2 className="text-white font-bold leading-snug mb-3" style={{ fontSize: "1.6rem" }}>
          팀 프로젝트의<br />모든 흐름을<br /><span style={{ color: "#818CF8" }}>AI가 연결합니다.</span>
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "#94A3B8" }}>
          회의록부터 업무, GitHub, 산출물, 기여도 평가까지<br />하나의 플랫폼에서 완성하세요.
        </p>
      </div>

      {/* feature list */}
      <div className="space-y-4">
        {[
          { icon: FileAudio, label: "회의록 AI 자동 요약", desc: "업로드만 하면 To-Do·일정 자동 생성" },
          { icon: Sparkles, label: "AI 어시스턴트", desc: "프로젝트 전체 데이터 기반 질문 답변" },
          { icon: Shield, label: "기여도 평가 보조", desc: "심사자 전용 개인별 근거 리포트 제공" },
        ].map(f => (
          <div key={f.label} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(112,72,232,0.25)" }}>
              <f.icon className="w-4 h-4" style={{ color: "#A78BFA" }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{f.label}</div>
              <div className="text-xs mt-0.5" style={{ color: "#64748B" }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
