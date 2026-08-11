const PERSON_COLOR_COUNT = 6;

/**
 * 사용자 ID를 사람색 1~6 중 하나로 매핑한다.
 * 팀원이 6명을 넘으면 순환한다. 색이 겹쳐도 이름이 항상 함께 나오므로 혼동이 없다.
 */
export function personColorIndex(userId: number): number {
  return (Math.abs(userId) % PERSON_COLOR_COUNT) + 1;
}

export function personColorClasses(userId: number): { text: string; bg: string } {
  const index = personColorIndex(userId);
  return {
    text: `text-person-${index}`,
    bg: `bg-person-${index}-bg`,
  };
}

// Tailwind는 조립된 클래스명을 스캔하지 못한다. 아래 배열이 스캔 대상이 되어
// person-1~6 클래스가 최종 CSS에 남는다. 지우면 색이 전부 사라진다.
export const PERSON_COLOR_SAFELIST = [
  "text-person-1", "bg-person-1-bg",
  "text-person-2", "bg-person-2-bg",
  "text-person-3", "bg-person-3-bg",
  "text-person-4", "bg-person-4-bg",
  "text-person-5", "bg-person-5-bg",
  "text-person-6", "bg-person-6-bg",
] as const;
