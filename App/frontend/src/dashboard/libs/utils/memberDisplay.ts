import type { Member } from "../../../global/lib/types/member";
import { stableColorForId } from "../../../global/lib/utils/memberColor";

export { stableColorForId };

export function resolveMemberDisplay(
  name: string | null | undefined,
  indexForColor: number,
  id?: string | null
): Member {
  const displayName = name?.trim() || "미배정";
  return {
    id: id ?? displayName,
    name: displayName,
    initials: displayName.slice(0, 1),
    color: stableColorForId(id ?? indexForColor),
    role: "팀원",
  };
}
