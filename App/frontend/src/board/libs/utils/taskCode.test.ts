import { describe, expect, it } from "vitest";
import { TASK_CODE_PREFIX, taskCode } from "./taskCode";

describe("taskCode", () => {
  it("업무 id 앞에 접두사를 붙인다", () => {
    expect(taskCode("230")).toBe("TASK-230");
  });

  it("접두사는 상수로 노출돼 화면과 검사가 같은 값을 쓴다", () => {
    expect(taskCode("7")).toBe(`${TASK_CODE_PREFIX}7`);
  });

  it("같은 id는 항상 같은 코드가 된다", () => {
    expect(taskCode("230")).toBe(taskCode("230"));
  });

  it("id가 비어 있으면 코드를 만들지 않는다", () => {
    expect(taskCode("")).toBe("");
  });
});
