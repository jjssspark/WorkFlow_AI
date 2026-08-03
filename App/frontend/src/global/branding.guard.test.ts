import { describe, expect, it } from "vitest";

/**
 * 브랜치를 딴 뒤에 생긴 파일은 그 브랜치의 어떤 검증도 통과하지 않는다.
 * 실제로 #549(브랜드 통일) 이후 #550이 랜딩페이지를 새로 들여오며 TF를 재도입했고,
 * 세 PR 모두 CI를 통과한 채 운영에 노출됐다.
 * 그래서 이 검사는 파일 목록을 미리 알지 않는다 — glob이 트리를 매번 다시 읽는다.
 */
const sources = {
  ...(import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  // index.html 은 src 밖이라 위 glob 이 닿지 않는다. 탭 제목·메타 태그가 여기 산다.
  ...(import.meta.glob("../../index.html", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
};

/**
 * 범위 밖이라 이 검사로는 못 막는 것들 — 넓히려다 조용히 실패하느니 적어 둔다.
 *  - CSS: glob 키는 잡히지만 ?raw 내용이 빈 문자열로 온다(Tailwind 플러그인이 먼저 가로챈다).
 *    아래 "내용이 비어 있지 않다" 검사가 이걸 잡으므로, 나중에 CSS를 넣으면 조용히
 *    통과하지 않고 붉은불이 뜬다.
 *  - 이미지: 픽셀로 박힌 브랜딩(랜딩페이지 스크린샷)은 텍스트 검사로 못 본다.
 *  - 서버 코드: 브랜드 문자열을 갖지 않는다.
 */
const MIN_SCANNED_FILES = 50;

/**
 * 단독 TF 만 브랜딩이다. 업무 코드 TASK-01 처럼 **뒤에** 하이픈이 오면 식별자이므로 뺀다.
 * 앞의 하이픈은 빼지 않는다 — `logo-TF`, `브랜드-TF` 는 여전히 브랜딩이고,
 * 양쪽을 다 빼면 그것들이 조용히 통과한다(초판이 실제로 그랬다).
 */
const BANNED = [
  { label: "TeamFlow", pattern: /TeamFlow/ },
  { label: "단독 TF", pattern: /(^|[^A-Za-z0-9])TF(?!-)([^A-Za-z0-9]|$)/ },
];

const scanned = Object.entries(sources).filter(
  ([path]) => !path.includes("branding.guard.test"),
);

function violations(pattern: RegExp): string[] {
  return scanned.flatMap(([path, code]) =>
    code
      .split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter(({ text }) => pattern.test(text))
      .map(({ line, text }) => `${path}:${line}  ${text}`),
  );
}

describe("브랜드 표기", () => {
  it("검사가 실제로 파일을 읽고 있다", () => {
    expect(scanned.length).toBeGreaterThan(MIN_SCANNED_FILES);
    expect(scanned.some(([path]) => path.endsWith("index.html"))).toBe(true);
    // 키만 세면 내용이 빈 파일을 "검사했다"고 착각한다. CSS 가 정확히 그랬다.
    expect(scanned.filter(([, code]) => code.trim() === "").map(([p]) => p)).toEqual([]);
  });

  it.each(BANNED)("$label 은 프론트엔드 소스에 남아 있지 않다", ({ pattern }) => {
    expect(violations(pattern)).toEqual([]);
  });
});
