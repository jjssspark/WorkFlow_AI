import type { Member } from "../../../global/lib/types/member";

const MEMBER_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"];

function hashSeed(seed: string): number {
  return [...seed].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

export function resolveMemberDisplay(
  name: string | null | undefined,
  indexForColor: number,
  id?: string | null
): Member {
  const displayName = name?.trim() || "미배정";
  const seed = id || displayName || String(indexForColor);
  return {
    id: id ?? displayName,
    name: displayName,
    initials: displayName.slice(0, 1),
    color: MEMBER_COLORS[Math.abs(hashSeed(seed)) % MEMBER_COLORS.length],
    role: "팀원",
  };
}
