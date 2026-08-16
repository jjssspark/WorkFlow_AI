import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Lock } from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { AuthInput } from "../components/AuthInput";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";
import { Button } from "../../global/component/ui/button";

const MIN_PASSWORD_LENGTH = 8;
// bcrypt는 72바이트를 넘는 입력을 자르지 않고 거부한다. 글자 수가 아니라 UTF-8 바이트가 기준이라
// 한글(3바이트)은 24자가 상한이다. 서버(PasswordPolicy)도 같은 값으로 막는다.
const MAX_PASSWORD_BYTES = 72;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

export function PasswordResetConfirmScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting || !token) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상으로 입력해주세요.`);
      return;
    }
    if (utf8Bytes(password) > MAX_PASSWORD_BYTES) {
      setError(
        `비밀번호가 너무 깁니다. ${MAX_PASSWORD_BYTES}바이트까지 쓸 수 있습니다(영문·숫자 ${MAX_PASSWORD_BYTES}자, 한글 24자).`,
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("두 비밀번호가 일치하지 않습니다.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch<void>("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (err) {
      // 이 화면은 이미 이메일로 전달된 토큰을 쥔 사용자만 도달하므로, 재설정 요청 화면과
      // 달리 서버 메시지를 그대로 보여줘도 계정 존재 여부가 새어나가지 않는다.
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
        <AuthBrandPanel />

        <div className="flex-1 flex items-center justify-center bg-background px-4 sm:px-8 overflow-y-auto">
          <div className="w-full max-w-sm py-8">
            <section aria-labelledby="reset-invalid-heading">
              <div className="mb-7">
                <h1 id="reset-invalid-heading" className="text-2xl font-bold text-foreground mb-1">비밀번호 재설정</h1>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-foreground">재설정 링크가 올바르지 않습니다. 다시 요청해 주세요.</p>
              </div>
              <p className="text-center text-sm text-muted-foreground mt-6">
                <Link to="/password-reset" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  재설정 메일 다시 받기
                </Link>
              </p>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center bg-background px-4 sm:px-8 overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          <section aria-labelledby="reset-heading">
            {done ? (
              <>
                <div className="mb-7">
                  <h1 id="reset-heading" className="text-2xl font-bold text-foreground mb-1">비밀번호 재설정</h1>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm text-foreground">비밀번호가 변경되었습니다.</p>
                </div>
                <Button type="button" onClick={() => navigate("/login")} className="w-full mt-6">
                  로그인하러 가기
                </Button>
              </>
            ) : (
              <>
                <div className="mb-7">
                  <h1 id="reset-heading" className="text-2xl font-bold text-foreground mb-1">비밀번호 재설정</h1>
                  <p className="text-sm text-muted-foreground">
                    새로 사용할 비밀번호를 입력해주세요.
                  </p>
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                  className="space-y-4"
                >
                  <AuthInput
                    label="새 비밀번호"
                    type="password"
                    placeholder="8자 이상 (한글은 24자까지)"
                    value={password}
                    onChange={setPassword}
                    icon={Lock}
                  />
                  <AuthInput
                    label="새 비밀번호 확인"
                    type="password"
                    placeholder="다시 입력"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    icon={Lock}
                  />

                  {error && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={submitting} className="w-full">
                    비밀번호 변경
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground mt-6">
                  <Link to="/password-reset" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                    재설정 메일 다시 받기
                  </Link>
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
