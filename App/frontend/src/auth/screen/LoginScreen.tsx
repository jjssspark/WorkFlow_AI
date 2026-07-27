import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { User, Lock, Eye, EyeOff, ArrowRight, Check, Clock } from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { AuthInput } from "../components/AuthInput";
import { useAuth } from "../../global/hooks/useAuth";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";
import type { AuthTokenResponse, SignupResponse } from "../../global/api/authTypes";
import { tokenStore } from "../../global/api/tokenStore";

const TEST_ACCOUNTS = [
  { username: "leader", name: "허영주", role: "팀장" },
  { username: "member1", name: "박상준", role: "팀원" },
  { username: "member2", name: "유소은", role: "팀원" },
  { username: "member3", name: "이은주", role: "팀원" },
  { username: "member4", name: "박지수", role: "팀원" },
  { username: "member5", name: "홍길동", role: "팀원" },
  { username: "reviewer", name: "고무서", role: "심사자" },
];
const TEST_PASSWORD = "1111";
const testLoginGuideEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === "true";

export function LoginScreen() {
  const navigate = useNavigate();
  const { loginWithGoogle, refreshMe } = useAuth();
  const [searchParams] = useSearchParams();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const oauthFailed = searchParams.get("error") === "oauth_failed";

  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);
  const [reapplyAffiliation, setReapplyAffiliation] = useState("");
  const [reapplyFacultyId, setReapplyFacultyId] = useState("");
  const [reapplying, setReapplying] = useState(false);
  const [reapplyError, setReapplyError] = useState<string | null>(null);
  const [reapplySubmitted, setReapplySubmitted] = useState(false);

  const handleLogin = async () => {
    if (loggingIn) return;
    if (!username.trim() || !password.trim()) {
      setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    setLoginError(null);
    setRejectedMessage(null);
    setLoggingIn(true);
    try {
      const id = username.trim();
      const isRealAccount = id.includes("@");
      const tokens = isRealAccount
        ? await apiFetch<AuthTokenResponse>("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: id, password }),
          })
        : await apiFetch<AuthTokenResponse>("/auth/test-login", {
            method: "POST",
            body: JSON.stringify({ username: id, password }),
          });
      tokenStore.clear();
      tokenStore.setTokens(tokens.accessToken, tokens.refreshToken, tokens.testSessionId ?? null);
      const me = await refreshMe();
      navigate(me?.user.isAdmin ? "/admin/reviewers" : "/projects", { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "REVIEWER_APPLICATION_REJECTED") {
        setRejectedMessage(error.message);
      } else if (error instanceof ApiRequestError) {
        setLoginError(error.message);
      } else {
        setLoginError("로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const fillTestAccount = (accountUsername: string) => {
    setLoginError(null);
    setUsername(accountUsername);
    setPassword(TEST_PASSWORD);
  };

  const handleReapply = async () => {
    if (reapplying || !reapplyAffiliation.trim() || !reapplyFacultyId.trim()) return;
    setReapplyError(null);
    setReapplying(true);
    try {
      const response = await apiFetch<SignupResponse>("/auth/reviewer-reapply", {
        method: "POST",
        body: JSON.stringify({
          email: username.trim(),
          password,
          affiliation: reapplyAffiliation.trim(),
          facultyId: reapplyFacultyId.trim(),
        }),
      });
      if (response.status === "PENDING_REVIEWER_APPROVAL") {
        setReapplySubmitted(true);
      }
    } catch (error) {
      setReapplyError(error instanceof ApiRequestError ? error.message : "재신청 처리에 실패했습니다.");
    } finally {
      setReapplying(false);
    }
  };

  const cancelReapply = () => {
    setRejectedMessage(null);
    setReapplySubmitted(false);
    setReapplyError(null);
    setReapplyAffiliation("");
    setReapplyFacultyId("");
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center bg-background px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-1">다시 만나서 반가워요!</h1>
            <p className="text-sm text-muted-foreground">계속하려면 로그인하세요.</p>
          </div>

          {rejectedMessage ? (
            reapplySubmitted ? (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(112,72,232,0.12)", color: "#7048E8" }}>
                  <Clock className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2">재신청이 접수되었습니다</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  관리자 승인 후 다시 로그인할 수 있습니다.
                </p>
                <button onClick={cancelReapply} className="w-full mt-5 text-sm font-semibold text-blue-600 hover:text-blue-700">
                  로그인 화면으로 돌아가기
                </button>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-bold text-foreground mb-2">심사자 신청이 거부되었습니다</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{rejectedMessage}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  소속과 교수 식별번호를 다시 확인하고 재신청하면 관리자가 다시 검토합니다.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground">소속기관 또는 학과</label>
                    <input
                      value={reapplyAffiliation}
                      onChange={e => setReapplyAffiliation(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      placeholder="예: 컴퓨터공학과"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">교수 일련번호 또는 교직원 번호</label>
                    <input
                      value={reapplyFacultyId}
                      onChange={e => setReapplyFacultyId(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      placeholder="예: PROF-2026-001"
                    />
                  </div>
                </div>

                {reapplyError && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                    {reapplyError}
                  </div>
                )}

                <button
                  onClick={() => void handleReapply()}
                  disabled={reapplying || !reapplyAffiliation.trim() || !reapplyFacultyId.trim()}
                  className="w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}
                >
                  {reapplying ? "재신청 처리 중..." : "재신청"}
                </button>
                <button onClick={cancelReapply} className="w-full mt-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
                  취소
                </button>
              </div>
            )
          ) : (
          <>
          {oauthFailed && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
              Google 로그인에 실패했습니다. 다시 시도해주세요.
            </div>
          )}

          <form onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
            <div className="space-y-4">
              <AuthInput label="아이디 또는 이메일" type="text" placeholder="아이디(예: leader) 또는 이메일"
                value={username} onChange={setUsername} icon={User} />
              <AuthInput
                label="비밀번호" type={showPassword ? "text" : "password"} placeholder="비밀번호 입력"
                value={password} onChange={setPassword} icon={Lock}
                right={
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
            </div>

            <div className="flex items-center justify-between mt-3 mb-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div onClick={() => setRemember(v => !v)}
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer ${remember ? "border-blue-500 bg-blue-500" : "border-border"}`}>
                  {remember && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className="text-xs text-muted-foreground">로그인 유지</span>
              </label>
              <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">비밀번호 찾기</button>
            </div>

            {loginError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-70 hover:opacity-90 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
            >
              {loggingIn ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 로그인 중...</>
              ) : (
                <><ArrowRight className="w-4 h-4" /> 로그인</>
              )}
            </button>
          </form>

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

          <p className="text-center text-sm text-muted-foreground mt-6">
            아직 계정이 없으신가요?{" "}
            <button onClick={() => navigate("/signup")} className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              회원가입
            </button>
          </p>

          {testLoginGuideEnabled && (
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-center text-[11px] font-semibold text-amber-600 mb-3">
                ⚠ 중간보고/시연용 테스트 계정 — 비밀번호는 전부 1111입니다
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TEST_ACCOUNTS.map((account) => (
                  <button
                    key={account.username}
                    type="button"
                    onClick={() => fillTestAccount(account.username)}
                    className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border border-dashed border-border bg-muted/40 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    title={`${account.name} / ${account.role}`}
                  >
                    <span>{account.username}</span>
                    <span className="text-[10px] text-muted-foreground">{account.name} · {account.role}</span>
                  </button>
                ))}
              </div>
              <p className="text-center text-[10px] text-muted-foreground mt-2">
                계정을 누르면 아이디/비밀번호가 자동으로 채워집니다. 로그인 버튼을 눌러 접속하세요.
              </p>
            </div>
          )}
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
