import { useState } from "react";
import { ApiRequestError } from "../../global/api/apiClient";
import { tokenStore } from "../../global/api/tokenStore";
import { changePassword } from "../libs/utils/passwordApi";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const inputClass =
  "w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

/**
 * 서버에 묻기 전에 걸러낼 수 있는 것만 여기서 본다. 현재 비밀번호가 맞는지는 서버만 알 수 있으므로
 * 여기서 판단하지 않는다. 반환값이 있으면 그것이 사용자에게 보여줄 문구다.
 */
function localValidationError(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상 ${MAX_PASSWORD_LENGTH}자 이하로 입력해주세요.`;
  }
  if (next !== confirm) {
    return "두 비밀번호가 일치하지 않습니다.";
  }
  if (next === current) {
    return "새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.";
  }
  return null;
}

export function PasswordChangeSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = Boolean(currentPassword && newPassword && confirmPassword) && !submitting;

  /** 다시 입력하기 시작하면 이전 시도의 결과 문구는 더 이상 이 화면의 상태가 아니다. */
  const clearFeedback = () => {
    setError(null);
    setDone(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setDone(false);

    const validationError = localValidationError(currentPassword, newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const tokens = await changePassword({ currentPassword, newPassword });
      // 비밀번호를 바꾼 시점 이전에 발급된 토큰은 서버가 거부한다. 갈아끼우지 않으면 액세스 토큰이
      // 만료되는 순간 본인이 이유 없이 로그아웃된다.
      tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">비밀번호 변경</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          변경하면 다른 기기의 세션은 최대 30분 안에 끊깁니다. 이 기기는 그대로 유지됩니다.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="current-password" className="text-xs font-semibold text-foreground">
          현재 비밀번호
        </label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => { setCurrentPassword(e.target.value); clearFeedback(); }}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-xs font-semibold text-foreground">
          새 비밀번호
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => { setNewPassword(e.target.value); clearFeedback(); }}
          className={inputClass}
        />
        <span className="text-xs text-muted-foreground">
          {MIN_PASSWORD_LENGTH}자 이상 {MAX_PASSWORD_LENGTH}자 이하
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-xs font-semibold text-foreground">
          새 비밀번호 확인
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); clearFeedback(); }}
          className={inputClass}
        />
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}
      {done && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
          비밀번호가 변경되었습니다.
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit}
        className="w-full py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
      >
        {submitting ? "변경 중..." : "비밀번호 변경"}
      </button>
    </section>
  );
}
