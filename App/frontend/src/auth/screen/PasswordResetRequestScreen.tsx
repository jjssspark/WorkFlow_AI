import { useState } from "react";
import { Link } from "react-router";
import { Mail } from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { AuthInput } from "../components/AuthInput";
import { apiFetch, ApiRequestError } from "../../global/api/apiClient";
import { Button } from "../../global/component/ui/button";

const SENT_NOTICE = "가입된 계정이면 비밀번호 재설정 메일을 보냈습니다.";

export function PasswordResetRequestScreen() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!email.trim()) {
      setError("이메일을 입력해주세요.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch<void>("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      // 서버가 계정 존재 여부를 알려주지 않으므로 화면도 항상 같은 문구를 보여준다.
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "요청에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center bg-background px-4 sm:px-8 overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          <section aria-labelledby="password-reset-heading">
            {sent ? (
              <>
                <div className="mb-7">
                  <h1 id="password-reset-heading" className="text-2xl font-bold text-foreground mb-1">비밀번호 찾기</h1>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm text-foreground">{SENT_NOTICE}</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    메일이 보이지 않으면 스팸함을 확인해주세요. 링크는 30분 후 만료됩니다.
                  </p>
                </div>
                <p className="text-center text-sm text-muted-foreground mt-6">
                  <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                    로그인으로 돌아가기
                  </Link>
                </p>
              </>
            ) : (
              <>
                <div className="mb-7">
                  <h1 id="password-reset-heading" className="text-2xl font-bold text-foreground mb-1">비밀번호 찾기</h1>
                  <p className="text-sm text-muted-foreground">
                    가입한 이메일로 재설정 링크를 보내드립니다.
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
                    label="이메일"
                    type="email"
                    placeholder="이메일 입력"
                    value={email}
                    onChange={setEmail}
                    icon={Mail}
                  />

                  {error && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={submitting} className="w-full">
                    재설정 메일 받기
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground mt-6">
                  <Link to="/find-email" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                    이메일이 기억나지 않나요?
                  </Link>
                </p>
                <p className="text-center text-sm text-muted-foreground mt-2">
                  <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                    로그인으로 돌아가기
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
