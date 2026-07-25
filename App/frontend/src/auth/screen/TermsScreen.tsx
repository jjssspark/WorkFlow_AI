import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Check, FileText } from "lucide-react";
import { SIGNUP_DRAFT_KEY } from "./SignupScreen";

const TERMS_SECTIONS = [
  {
    title: "제1조 (목적)",
    body: "이 약관은 TeamFlow AI(이하 \"회사\")가 제공하는 팀 프로젝트 관리 서비스(이하 \"서비스\")의 이용과 관련하여 회사와 회원 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.",
  },
  {
    title: "제2조 (정의)",
    body: "\"회원\"이란 이 약관에 동의하고 회사와 서비스 이용계약을 체결한 자를 말합니다. \"콘텐츠\"란 회원이 서비스를 이용하며 등록한 회의록, 업무, 산출물, 평가 자료 등 일체의 정보를 말합니다.",
  },
  {
    title: "제3조 (약관의 효력 및 변경)",
    body: "이 약관은 서비스 화면에 게시하거나 기타의 방법으로 회원에게 공지함으로써 효력이 발생합니다. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 적용일자 및 사유를 명시하여 사전 공지합니다.",
  },
  {
    title: "제4조 (회원가입 및 계정 관리)",
    body: "회원은 회사가 정한 절차에 따라 회원가입을 신청하며, 회사는 서비스 운영상 또는 기술상 지장이 없는 한 이를 승낙합니다. 회원은 계정 정보를 본인만 이용하도록 관리할 책임이 있으며, 제3자에게 양도·대여할 수 없습니다.",
  },
  {
    title: "제5조 (개인정보의 보호)",
    body: "회사는 관련 법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력하며, 개인정보의 수집·이용·제공에 관한 사항은 별도의 개인정보처리방침에 따릅니다.",
  },
  {
    title: "제6조 (회원의 의무)",
    body: "회원은 서비스 이용과 관련하여 관계 법령, 이 약관의 규정, 이용안내 및 서비스와 관련하여 공지한 주의사항을 준수해야 하며, 회사의 업무에 방해되는 행위를 해서는 안 됩니다.",
  },
  {
    title: "제7조 (서비스 제공의 중지)",
    body: "회사는 시스템 점검, 교체, 고장, 통신 두절 등 운영상 상당한 이유가 있는 경우 서비스 제공을 일시적으로 중단할 수 있으며, 이 경우 사전 또는 사후에 회원에게 공지합니다.",
  },
  {
    title: "제8조 (면책조항)",
    body: "회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 책임이 면제됩니다. 회원이 서비스에 게재한 정보, 자료의 신뢰도, 정확성에 대해서는 회원 본인이 책임을 집니다.",
  },
  {
    title: "제9조 (분쟁 해결)",
    body: "회사와 회원 간 발생한 분쟁에 대해서는 대한민국 법을 적용하며, 분쟁 발생 시 회사의 본사 소재지를 관할하는 법원을 관할 법원으로 합니다.",
  },
];

export function TermsScreen() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  const handleAgree = () => {
    try {
      const raw = sessionStorage.getItem(SIGNUP_DRAFT_KEY);
      const draft = raw ? JSON.parse(raw) : {};
      sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({ ...draft, agreed: true }));
    } catch {
      // sessionStorage를 못 쓰는 환경이면 그냥 넘어간다 — 회원가입 화면에서 다시 체크하면 된다.
    }
    setChecked(true);
    navigate("/signup");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <div className="w-full max-w-2xl">
        <button
          type="button"
          onClick={() => navigate("/signup")}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> 회원가입으로 돌아가기
        </button>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 sm:px-8 py-6 border-b border-border flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(59,91,219,0.12)", color: "#3B5BDB" }}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">이용약관</h1>
              <p className="text-xs text-muted-foreground mt-0.5">시행일자: 2026년 7월 24일</p>
            </div>
          </div>

          <div className="px-6 sm:px-8 py-6 max-h-[55vh] overflow-y-auto space-y-5">
            {TERMS_SECTIONS.map((section) => (
              <div key={section.title}>
                <h2 className="text-sm font-bold text-foreground mb-1.5">{section.title}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>

          <div className="px-6 sm:px-8 py-5 border-t border-border bg-muted/30">
            <button
              type="button"
              onClick={handleAgree}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? "border-white bg-white/20" : "border-white/70"}`}>
                {checked && <Check className="w-3 h-3 text-white" />}
              </div>
              위 이용약관에 동의합니다
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
