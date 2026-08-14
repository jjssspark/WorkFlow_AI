import { useState } from "react";
import { Link } from "react-router";
import { User, Building2, Search } from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { AuthInput } from "../components/AuthInput";
import { apiFetch } from "../../global/api/apiClient";
import { Button } from "../../global/component/ui/button";

interface FindEmailResponse {
  maskedEmails: string[];
}

export function FindEmailScreen() {
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!name.trim() || !affiliation.trim()) {
      setError("이름과 소속을 모두 입력해주세요.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<FindEmailResponse>("/auth/find-email", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), affiliation: affiliation.trim() }),
      });
      setResult(data.maskedEmails);
    } catch {
      // 이 화면의 존재 이유가 계정 열거 차단이므로, 서버 메시지를 그대로 보여주지 않고
      // 항상 같은 고정 문구만 노출한다.
      setError("조회에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center bg-background px-4 sm:px-8 overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          <section aria-labelledby="find-email-heading">
            <div className="mb-7">
              <h1 id="find-email-heading" className="text-2xl font-bold text-foreground mb-1">아이디 찾기</h1>
              <p className="text-sm text-muted-foreground">
                가입할 때 등록한 이름과 소속을 입력하면 이메일 일부를 알려드립니다.
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
                label="이름"
                placeholder="이름 입력"
                value={name}
                onChange={setName}
                icon={User}
              />
              <AuthInput
                label="소속"
                placeholder="소속 입력"
                value={affiliation}
                onChange={setAffiliation}
                icon={Building2}
              />

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                <Search className="w-4 h-4" /> 아이디 찾기
              </Button>
            </form>

            {result !== null && (
              <div className="mt-5 rounded-xl border border-border bg-card p-4">
                {result.length > 0 ? (
                  <ul className="space-y-1.5 text-sm text-foreground">
                    {result.map((email) => (
                      <li key={email}>{email}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    일치하는 계정을 찾지 못했습니다. 입력한 정보를 다시 확인해주세요.
                  </p>
                )}
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                로그인으로 돌아가기
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
