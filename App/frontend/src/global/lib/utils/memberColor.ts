/** 헤더 아바타 + 대시보드 전역 담당자 아바타 칩이 공유하는 단일 색상 배정 소스.
 * 사람마다 서로 다른 색을 갖되, 페이지마다 목록 순서(index)나 새로고침/화면 진입 순서가
 * 달라도 같은 사람은 항상 같은 색이어야 한다.
 *
 * "처음 보는 id부터 팔레트를 순서대로 하나씩 배정"하는 방식(모듈 레벨 Map + 카운터)은
 * 순서 의존성을 완전히 없애지 못한다 — 어떤 컴포넌트가 먼저 id를 조회하느냐(렌더 순서,
 * 데이터 도착 순서)에 따라 같은 사람이 새로고침마다 다른 색을 받을 수 있고, 그 배정
 * 자체가 브라우저 세션에만 살아있어 세션이 새로 시작되면 또 달라진다.
 * id % 팔레트크기 방식도 문제였지만, 원인은 "id 기반 고정 배정" 자체가 아니라 나머지
 * 연산이 만드는 산술적 규칙성(팔레트 크기만큼 떨어진 id가 항상 충돌)이었다.
 * 그래서 id를 문자열 해시로 흩뿌린 뒤 팔레트 크기로 나눠, 순서와 무관하게 결정적으로
 * (deterministic) 같은 id는 항상 같은 색을 받도록 한다. 여전히 팔레트보다 인원이 많으면
 * 서로 다른 두 사람이 같은 색을 받을 수 있지만(비둘기집 원리상 유한 팔레트로는 피할 수
 * 없음), 최소한 "같은 사람 = 항상 같은 색"은 렌더/새로고침 순서와 무관하게 보장된다. */
const MEMBER_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16", "#0EA5E9", "#F97316"];

function hashToPaletteIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % MEMBER_COLORS.length;
}

/** 사용자 ID(또는 이름 등 안정적인 식별자) 기준으로 팔레트에서 고정 색을 고른다.
 * 같은 key는 프로세스/세션/렌더 순서와 무관하게 항상 같은 색을 반환한다. */
export function stableColorForId(id: string | number | null | undefined): string {
  if (id == null || id === "") return MEMBER_COLORS[0];
  return MEMBER_COLORS[hashToPaletteIndex(String(id))];
}
