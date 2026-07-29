import { useEffect, useState } from "react";
import { createInvitationLink, getProject } from "../../api/projectsApi";

type CopyKind = "code" | "link";
type CopyResult = { kind: CopyKind; ok: boolean };

export function InviteCodeSection({ projectId }: { projectId: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  // 코드 복사/링크 복사 중 가장 최근에 한 동작 하나만 보여준다 - 둘 다 상태를 남기면
  // 코드는 성공하고 링크는 실패했을 때 메시지 두 줄이 동시에 떠서 헷갈린다.
  const [lastCopy, setLastCopy] = useState<CopyResult | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getProject(projectId)
      .then((project) => { if (alive) setCode(project.inviteCode); })
      .catch(() => { if (alive) setCode(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  // 코드는 화면에 노출하지 않는다 - 팀원 공유는 복사 버튼을 통해서만 이뤄지도록 한다.
  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setLastCopy({ kind: "code", ok: true });
    } catch {
      setLastCopy({ kind: "code", ok: false });
    }
  }

  // 클릭할 때마다 서버에 새로 물어본다: 캐시해두면 이미 다른 사람이 써서 만료된
  // 토큰을 계속 복사해줄 수 있다. 서버가 유효한 토큰이 있으면 재사용해서 응답하므로
  // 반복 클릭이 새 초대를 계속 만들지는 않는다.
  async function copyLink() {
    setLinkLoading(true);
    try {
      const invitation = await createInvitationLink(projectId);
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${invitation.token}`);
      setLastCopy({ kind: "link", ok: true });
    } catch {
      setLastCopy({ kind: "link", ok: false });
    } finally {
      setLinkLoading(false);
    }
  }

  if (loading) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드 불러오는 중</div>;
  if (!code) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드를 불러오지 못했습니다</div>;

  return (
    <div className="px-3 py-2 border-t border-white/10">
      <div className="text-[10px] text-white/50 mb-2">팀원 초대</div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={copyCode}
          className="flex-1 px-2 py-1 rounded text-[10px] bg-white/10 text-white hover:bg-white/20"
        >
          코드 복사
        </button>
        <button
          type="button"
          onClick={copyLink}
          disabled={linkLoading}
          className="flex-1 px-2 py-1 rounded text-[10px] bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
        >
          {linkLoading ? "생성 중..." : "링크 복사"}
        </button>
      </div>
      {lastCopy && (
        <div className="mt-1 text-[10px] text-white/60">
          {lastCopy.ok
            ? `${lastCopy.kind === "code" ? "코드" : "링크"}를 복사했습니다`
            : "복사하지 못했습니다. 다시 시도해주세요"}
        </div>
      )}
    </div>
  );
}
