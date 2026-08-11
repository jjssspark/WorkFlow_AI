import { describe, it, expect } from "vitest";
import { personColorIndex, personColorClasses } from "./personColor";

describe("personColorIndex", () => {
  it("항상 1에서 6 사이를 반환한다", () => {
    for (let id = 1; id <= 100; id += 1) {
      const index = personColorIndex(id);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(6);
    }
  });

  it("같은 ID는 항상 같은 색을 받는다", () => {
    expect(personColorIndex(42)).toBe(personColorIndex(42));
  });

  it("연속한 ID는 서로 다른 색을 받는다", () => {
    expect(personColorIndex(1)).not.toBe(personColorIndex(2));
  });

  it("6명까지는 색이 겹치지 않는다", () => {
    const indexes = [1, 2, 3, 4, 5, 6].map(personColorIndex);
    expect(new Set(indexes).size).toBe(6);
  });
});

describe("personColorClasses", () => {
  it("Tailwind 클래스 문자열을 반환한다", () => {
    const classes = personColorClasses(1);
    expect(classes.text).toMatch(/^text-person-[1-6]$/);
    expect(classes.bg).toMatch(/^bg-person-[1-6]-bg$/);
  });
});
