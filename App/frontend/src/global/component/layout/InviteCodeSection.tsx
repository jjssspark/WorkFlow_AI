import { useEffect, useState } from "react";
import { getProject } from "../../api/projectsApi";

export function InviteCodeSection({ projectId }: { projectId: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyOk, setCopyOk] = useState<boolean | null>(null);

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
      setCopyOk(true);
    } catch {
      setCopyOk(false);
    }
  }

  if (loading) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드 불러오는 중</div>;
  if (!code) return <div className="px-3 py-2 text-[11px] text-white/50">초대 코드를 불러오지 못했습니다</div>;

  return (
    <div className="px-3 py-2 border-t border-white/10">
      <div className="text-[10px] text-white/50 mb-2">팀원 초대</div>
      <button
        type="button"
        onClick={copyCode}
        className="w-full px-2 py-1 rounded text-[10px] bg-white/10 text-white hover:bg-white/20"
      >
        코드 복사
      </button>
      {copyOk !== null && (
        <div className="mt-1 text-[10px] text-white/60">
          {copyOk ? "코드를 복사했습니다" : "복사하지 못했습니다. 다시 시도해주세요"}
        </div>
      )}
    </div>
  );
}
