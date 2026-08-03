import { describe, expect, it } from "vitest";

/**
 * 브랜치를 딴 뒤에 생긴 파일은 그 브랜치의 어떤 검증도 통과하지 않는다.
 * 실제로 #549(브랜드 통일) 이후 #550이 랜딩페이지를 새로 들여오며 TF를 재도입했고,
 * 세 PR 모두 CI를 통과한 채 운영에 노출됐다.
 * 그래서 이 검사는 파일 목록을 미리 알지 않는다 — glob이 트리를 매번 다시 읽는다.
 */
const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 업무 코드 TF-01 은 브랜딩이 아니므로 뒤에 하이픈이 붙은 형태는 제외한다. */
const BANNED = [
  { label: "TeamFlow", pattern: /TeamFlow/g },
  { label: "단독 TF", pattern: /(^|[^A-Za-z0-9-])TF([^A-Za-z0-9-]|$)/g },
];

function violations(label: string, pattern: RegExp) {
  return Object.entries(sources)
    .filter(([path]) => !path.includes(".guard.test."))
    .flatMap(([path, code]) =>
      code
        .split("\n")
        .map((line, i) => ({ path, line: i + 1, text: line.trim() }))
        .filter(({ text }) => new RegExp(pattern.source).test(text))
        .map(({ path: p, line, text }) => `${p}:${line}  ${text}`),
    )
    .map((v) => `[${label}] ${v}`);
}

describe("브랜드 표기", () => {
  it.each(BANNED)("$label 은 소스 어디에도 남아 있지 않다", ({ label, pattern }) => {
    expect(violations(label, pattern)).toEqual([]);
  });
});
