import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { acceptInvitation, joinProjectByCode } from "../../global/api/projectsApi";

type Status = "loading" | "success" | "error";

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
        // 이메일 초대 토큰이 아니라 사이드바에서 복사한 프로젝트 참여 코드일 수 있으니 재시도한다.
        joinProjectByCode(token)
          .then(() => setStatus("success"))
          .catch(() => {
            setStatus("error");
            setMessage(emailInviteErr instanceof Error ? emailInviteErr.message : "초대 수락에 실패했습니다.");
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
