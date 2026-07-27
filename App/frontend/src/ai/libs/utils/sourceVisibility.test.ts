import { describe, expect, it } from "vitest";
import { shouldShowSources } from "./sourceVisibility";
import type { RagSource } from "../types/chat";

const source: RagSource = {
  sourceType: "task",
  sourceId: 1,
  contentSnippet: "로그인 API 구현",
  similarity: 0.5,
};

describe("shouldShowSources", () => {
  it("hides sources when the answer says there is no evidence", () => {
    expect(shouldShowSources("근거 없음: 관련 자료를 찾지 못했습니다", [source])).toBe(false);
  });

  it("hides sources even when the answer has surrounding whitespace", () => {
    expect(shouldShowSources("  근거 없음: 관련 자료를 찾지 못했습니다  ", [source])).toBe(false);
  });

  it("shows sources for a normal answer", () => {
    expect(shouldShowSources("WF-240 업무는 2026-07-20 마감입니다", [source])).toBe(true);
  });

  it("shows sources when the answer merely mentions the phrase mid-sentence", () => {
    expect(shouldShowSources("마감일에 대한 근거 없음을 확인했습니다", [source])).toBe(true);
  });

  it("hides sources when there are none", () => {
    expect(shouldShowSources("정상 답변", [])).toBe(false);
  });
});
