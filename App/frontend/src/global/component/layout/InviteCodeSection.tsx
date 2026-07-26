import { useEffect, useState } from "react";
import { getProject } from "../../api/projectsApi";

export function InviteCodeSection({ projectId }: { projectId: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getProject(projectId)
      .then((project) => { if (alive) setCode(project.inviteCode); })
      .catch(() => { if (alive) setCode(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  // clipboard API는 http 접속이나 권한 거부 시 없거나 거부된다. 그대로 두면 미처리 rejection이
  // 나고 사용자는 복사됐는지 알 수 없다. 실패를 알려 코드를 직접 선택해 복사하도록 유도한다.
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  if (loading) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드 불러오는 중</div>;
  if (!code) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드를 불러오지 못했습니다</div>;

  return (
    <div className="px-3 py-2 border-t border-white/10">
      <div className="text-[10px] text-white/50 mb-1">팀원 초대 코드</div>
      <div className="font-mono text-xs text-white tracking-wider mb-2">{code}</div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => copy(code)}
          className="px-2 py-1 rounded text-[10px] bg-white/10 text-white hover:bg-white/20"
        >
          코드 복사
        </button>
        <button
          type="button"
          onClick={() => copy(`${window.location.origin}/projects`)}
          className="px-2 py-1 rounded text-[10px] bg-white/10 text-white hover:bg-white/20"
        >
          링크 복사
        </button>
      </div>
      {copyState === "copied" && <div className="mt-1 text-[10px] text-white/60">복사했습니다</div>}
      {copyState === "failed" && (
        <div className="mt-1 text-[10px] text-white/60">복사하지 못했습니다. 코드를 직접 선택해 복사해주세요</div>
      )}
    </div>
  );
}
