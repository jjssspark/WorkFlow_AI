import { useEffect, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { AuthInput } from "../components/AuthInput";
import { useAuth } from "../../global/hooks/useAuth";
import { API_BASE_URL, apiFetch, ApiRequestError, type ApiEnvelope } from "../../global/api/apiClient";
import type { AuthTokenResponse, SignupResponse } from "../../global/api/authTypes";
import { tokenStore } from "../../global/api/tokenStore";

const demoAuthEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === "true";

// 회원가입 폼은 순수 useState라 /terms로 이동했다 돌아오면 초기화된다 — sessionStorage에 임시 저장해 왕복 시 값을 유지한다.
export const SIGNUP_DRAFT_KEY = "workflow-ai:signup-draft";

interface SignupDraft {
  name: string;
  email: string;
  pw: string;
  pwConfirm: string;
  isProfessor: boolean;
  agreed: boolean;
}

function loadSignupDraft(): SignupDraft | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SignupDraft) : null;
  } catch {
    return null;
  }
}

export function SignupScreen() {
  const navigate = useNavigate();
  const { loginWithGoogle, refreshMe } = useAuth();
  const draft = loadSignupDraft();
  const [name, setName] = useState(draft?.name ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [pw, setPw] = useState(draft?.pw ?? "");
  const [pwConfirm, setPwConfirm] = useState(draft?.pwConfirm ?? "");
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(draft?.agreed ?? false);
  const [loading, setLoading] = useState(false);
  const [isProfessor, setIsProfessor] = useState(draft?.isProfessor ?? false);
  const [professorNo, setProfessorNo] = useState("");
  const [certificateName, setCertificateName] = useState("");
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  useEffect(() => {
    const nextDraft: SignupDraft = { name, email, pw, pwConfirm, isProfessor, agreed };
    sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(nextDraft));
  }, [name, email, pw, pwConfirm, isProfessor, agreed]);

  const goToTerms = () => navigate("/terms");

  const pwMatch = Boolean(pw && pwConfirm && pw === pwConfirm);
  const pwMismatch = Boolean(pw && pwConfirm && pw !== pwConfirm);
  const professorValid = !isProfessor || Boolean(professorNo.trim() || certificateName);
  const valid = Boolean(name.trim() && email.trim() && pw && pwMatch && agreed && professorValid);

  const handleCertificateChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCertificateName(event.target.files?.[0]?.name ?? "");
  };

  // 데모 전용: "승인 완료 시연하기" 버튼(demoAuthEnabled일 때만 노출)에서만 사용 — 실제 회원가입 흐름과는 무관.
  const loginWithDevAccount = async (demoUserId: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/dev-login-token/${demoUserId}`);
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("인증 서버가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
    }
    const body = await response.json() as ApiEnvelope<AuthTokenResponse>;
    if (!response.ok || !body.success || !body.data?.accessToken || !body.data?.refreshToken) {
      throw new Error(body.error?.message ?? "회원가입 처리에 실패했습니다.");
    }
    tokenStore.clear();
    tokenStore.setTokens(body.data.accessToken, body.data.refreshToken, null);
    await refreshMe();
  };

  const handleSubmit = async () => {
    if (!valid || loading) return;
    setSignupError(null);
    setLoading(true);
    try {
      const response = await apiFetch<SignupResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password: pw,
          name: name.trim(),
          roleType: isProfessor ? "REVIEWER" : "MEMBER",
        }),
      });

      if (response.status === "PENDING_REVIEWER_APPROVAL") {
        setApprovalSubmitted(true);
        return;
      }

      if (response.tokens) {
        tokenStore.clear();
        tokenStore.setTokens(response.tokens.accessToken, response.tokens.refreshToken, null);
        await refreshMe();
      }
      sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
      navigate("/projects", { replace: true });
    } catch (error) {
      setSignupError(error instanceof ApiRequestError ? error.message : "회원가입 처리에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleApproveDemo = async () => {
    if (!demoAuthEnabled || loading) {
      navigate("/login");
      return;
    }
    setSignupError(null);
    setLoading(true);
    try {
      await loginWithDevAccount("6");
      navigate("/projects", { replace: true });
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : "심사자 승인 시연에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center bg-background px-4 sm:px-8 overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          {approvalSubmitted ? (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(112,72,232,0.12)", color: "#7048E8" }}>
                <Clock className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">관리자 승인 대기 중</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                교수 인증 정보가 제출되었습니다. 관리자 승인 후 가입이 완료되며,
                승인된 계정은 심사자 권한으로 로그인됩니다.
              </p>

              <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-violet-600 mt-0.5" />
                  <div>
                    <div className="text-sm font-bold text-violet-700">승인 후 제공 화면</div>
                    <div className="text-xs text-violet-600 mt-1 leading-relaxed">
                      담당 프로젝트 목록, 개인별 기여도 리포트, AI 평가 근거, 최종 점수 입력 화면
                    </div>
                  </div>
                </div>
              </div>

              {signupError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                  {signupError}
                </div>
              )}

              {demoAuthEnabled && (
                <button
                  onClick={() => void handleApproveDemo()}
                  disabled={loading}
                  className="mt-5 w-full py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {loading ? "승인 처리 중..." : "승인 완료 시연하기"}
                </button>
              )}
              <button onClick={() => navigate("/login")} className="w-full mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">
                로그인 화면으로 이동
              </button>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-foreground mb-1">TeamFlow AI 시작하기</h1>
                <p className="text-sm text-muted-foreground">팀 프로젝트를 스마트하게 관리해보세요.</p>
              </div>

              <div className="space-y-4">
                <AuthInput label="이름" placeholder="실명을 입력하세요" value={name} onChange={setName} icon={User} />
                <AuthInput label="이메일" type="email" placeholder="name@university.ac.kr" value={email} onChange={setEmail} icon={Mail} />
                <AuthInput
                  label="비밀번호"
                  type={showPw ? "text" : "password"}
                  placeholder="8자 이상 입력"
                  value={pw}
                  onChange={setPw}
                  icon={Lock}
                  right={
                    <button type="button" onClick={() => setShowPw(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">비밀번호 확인</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="password"
                      placeholder="비밀번호를 다시 입력"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      className={`w-full rounded-xl border text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 transition-all bg-input-background ${
                        pwMismatch
                          ? "border-red-400 focus:ring-red-100"
                          : pwMatch
                            ? "border-emerald-400 focus:ring-emerald-100"
                            : "border-border focus:border-blue-400 focus:ring-blue-100"
                      }`}
                      style={{ padding: "10px 36px 10px 36px" }}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {pwMatch && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {pwMismatch && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    </div>
                  </div>
                  {pwMismatch && <span className="text-xs text-red-500">비밀번호가 일치하지 않습니다.</span>}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-card p-4">
                <button type="button" onClick={() => setIsProfessor(v => !v)} className="w-full flex items-start gap-3 text-left">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 shrink-0 ${isProfessor ? "border-violet-500 bg-violet-500" : "border-border"}`}>
                    {isProfessor && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="w-4 h-4 text-violet-600" />
                      <span className="text-sm font-bold text-foreground">교수/심사자 계정으로 신청합니다</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      인증 후 심사자 전용 UI와 평가 기능을 사용할 수 있습니다.
                    </p>
                  </div>
                </button>

                {isProfessor && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground">교수 일련번호 또는 교직원 번호</label>
                      <input
                        value={professorNo}
                        onChange={e => setProfessorNo(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        placeholder="예: PROF-2026-001"
                      />
                    </div>
                    <label className="block">
                      <span className="text-xs font-semibold text-foreground">인증 서류 첨부</span>
                      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50 px-3 py-3">
                        <FileText className="w-4 h-4 text-violet-600" />
                        <span className="flex-1 text-xs text-violet-700 truncate">{certificateName || "재직증명서, 교원증 이미지 등"}</span>
                        <span className="text-xs font-semibold text-violet-700">선택</span>
                      </div>
                      <input type="file" className="hidden" onChange={handleCertificateChange} />
                    </label>
                    <div className="text-xs text-violet-600 bg-violet-50 rounded-lg px-3 py-2">
                      가입하기를 누르면 관리자 승인 후 가입 처리됩니다.
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2 mt-5 mb-6 select-none">
                <button
                  type="button"
                  aria-label={agreed ? "이용약관 동의 해제" : "이용약관 보기"}
                  onClick={() => (agreed ? setAgreed(false) : goToTerms())}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all mt-0.5 cursor-pointer shrink-0 ${agreed ? "border-blue-500 bg-blue-500" : "border-slate-400 bg-input-background"}`}
                >
                  {agreed && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  <button type="button" onClick={goToTerms} className="font-semibold text-blue-600 hover:text-blue-700">이용약관</button> 및{" "}
                  <button type="button" className="font-semibold text-blue-600 hover:text-blue-700">개인정보처리방침</button>에 동의합니다.
                  {!agreed && <span className="block mt-1 text-[11px] text-muted-foreground">이용약관을 끝까지 확인해야 동의할 수 있습니다.</span>}
                </span>
              </div>

              {signupError && (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                  {signupError}
                </div>
              )}

              <button
                onClick={() => void handleSubmit()}
                disabled={!valid || loading}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-50 hover:opacity-90 flex items-center justify-center gap-2"
                style={{ background: valid ? "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" : "#C1C9D9" }}
              >
                {loading ? (
                  <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 가입 중...</>
                ) : (
                  <><ArrowRight className="w-4 h-4" /> 가입하기</>
                )}
              </button>

              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">또는</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <button
                onClick={loginWithGoogle}
                className="w-full py-3 rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-all hover:bg-muted flex items-center justify-center gap-2.5"
              >
                <GoogleIcon />
                Google로 계속하기
              </button>

              <p className="text-center text-sm text-muted-foreground mt-4">
                이미 계정이 있으신가요?{" "}
                <button onClick={() => navigate("/login")} className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  로그인
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.7 34.9 27 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.6C39.5 37.4 44 31.3 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}
