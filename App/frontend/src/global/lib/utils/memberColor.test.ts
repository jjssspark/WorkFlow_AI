import { describe, expect, it } from "vitest";
import { stableColorForId } from "./memberColor";

describe("stableColorForId", () => {
  it("returns the same color for the same id regardless of call order", () => {
    // 순서를 바꿔 호출해도(다른 컴포넌트가 먼저 조회하는 상황을 흉내냄) 같은 id는
    // 항상 같은 색을 받아야 한다 - 렌더/새로고침 순서에 의존하지 않는다는 핵심 요구사항.
    const colorA1 = stableColorForId("42");
    const colorB = stableColorForId("7");
    const colorA2 = stableColorForId("42");

    expect(colorA1).toBe(colorA2);
    expect(colorA1).not.toBe(colorB);
  });

  it("does not depend on which id was seen first (no encounter-order state)", () => {
    // 이전 구현은 "처음 보는 id" 순서로 팔레트를 배정해 호출 순서에 따라 결과가 달랐다.
    // 새 구현은 순수 함수라 호출 순서를 바꿔도 각 id의 색이 그대로여야 한다.
    const first = ["1", "2", "3"].map(stableColorForId);
    const second = ["3", "2", "1"].map(stableColorForId).reverse();

    expect(second).toEqual(first);
  });

  it("assigns different colors to ids that were the old modulo scheme's known collision case", () => {
    // 팔레트 크기(10)만큼 떨어진 두 id는 예전 "id % 10" 방식에서 항상 충돌했다.
    // 해시 기반에서는 우연히 같을 수는 있어도 이 특정 케이스에서 구조적으로 항상
    // 충돌하지는 않는다는 것을 확인한다.
    const color1 = stableColorForId("1");
    const color11 = stableColorForId("11");

    expect(color1).not.toBe(color11);
  });

  it("falls back to a default color for null/undefined/empty ids", () => {
    expect(stableColorForId(null)).toBe(stableColorForId(undefined));
    expect(stableColorForId("")).toBe(stableColorForId(null));
  });

  it("treats numeric and string forms of the same id identically", () => {
    expect(stableColorForId(42)).toBe(stableColorForId("42"));
  });
});
