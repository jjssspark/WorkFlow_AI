import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../../global/api/apiClient";
import { acceptInvitation, joinProjectByCode } from "../../global/api/projectsApi";

type Status = "loading" | "success" | "error";

// 백엔드가 이 코드로 응답할 때만 "이메일 초대 토큰이 아니라 프로젝트 참여 코드였다"고 확신할 수 있다
// (InvitationController.accept 참고). 네트워크 오류/5xx/권한 없음/이미 처리된 초대까지 폴백하면
// 원래 실패 사유(예: "이미 처리된 초대입니다")가 무관한 "유효하지 않은 초대 코드"로 덮여버린다.
const FALLBACK_ELIGIBLE_CODE = "INVITE_NOT_FOUND";

export function InviteAcceptScreen() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const handled = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    sessionStorage.removeItem("pendingInvite");

    if (!token) {
      setStatus("error");
      setMessage("초대 링크가 올바르지 않습니다.");
      return;
    }

    acceptInvitation(token)
      .then(() => setStatus("success"))
      .catch((emailInviteErr: unknown) => {
        const isUnknownToken = emailInviteErr instanceof ApiRequestError && emailInviteErr.code === FALLBACK_ELIGIBLE_CODE;
        if (!isUnknownToken) {
          // 네트워크 오류, 5xx, 권한 없음, 이미 처리/만료된 초대 등은 폴백 대상이 아니다 — 실제 원인을 그대로 보여준다.
          setStatus("error");
          setMessage(emailInviteErr instanceof Error ? emailInviteErr.message : "초대 수락에 실패했습니다.");
          return;
        }

        // 이메일 초대 토큰이 아니라 사이드바에서 복사한 프로젝트 참여 코드일 수 있으니 재시도한다.
        joinProjectByCode(token)
          .then(() => setStatus("success"))
          .catch((joinErr: unknown) => {
            console.error("초대 코드 참여 폴백 실패", joinErr);
            setStatus("error");
            setMessage(joinErr instanceof Error ? joinErr.message : "초대 수락에 실패했습니다.");
          });
      });
  }, [token]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-full max-w-sm text-center px-6">
        {status === "loading" && (
          <p className="text-sm text-muted-foreground">초대 확인 중...</p>
        )}
        {status === "success" && (
          <>
            <p className="text-sm font-medium mb-4">프로젝트에 참여했습니다.</p>
            <button
              type="button"
              onClick={() => navigate("/dashboard", { replace: true })}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "#3B5BDB" }}
            >
              대시보드로 이동
            </button>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-sm font-medium mb-4 text-destructive">{message}</p>
            <button
              type="button"
              onClick={() => navigate("/projects", { replace: true })}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "#3B5BDB" }}
            >
              프로젝트 목록으로
            </button>
          </>
        )}
      </div>
    </div>
  );
}
