import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { tokenStore } from "../../global/api/tokenStore";
import { useAuth } from "../../global/hooks/useAuth";

export function GoogleCallbackScreen() {
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(rawHash);
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    // 토큰이 담긴 프래그먼트를 히스토리/화면 URL에서 즉시 제거한다 (뒤로가기·URL 공유 시 토큰 노출 방지).
    window.history.replaceState(null, "", window.location.pathname);

    if (!accessToken || !refreshToken) {
      navigate("/login?error=oauth_failed", { replace: true });
      return;
    }

    tokenStore.setTokens(accessToken, refreshToken, null);
    refreshMe()
      // 관리자는 심사자 승인 화면으로, 그 외에는 프로젝트 선택/생성/초대 코드 입력이 먼저 필요하므로
      // /dashboard가 아닌 /projects로 진입한다.
      .then((me) => navigate(me?.user.isAdmin ? "/admin/reviewers" : "/projects", { replace: true }))
      .catch(() => navigate("/login?error=oauth_failed", { replace: true }));
  }, [navigate, refreshMe]);

  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
      로그인 처리 중...
    </div>
  );
}
