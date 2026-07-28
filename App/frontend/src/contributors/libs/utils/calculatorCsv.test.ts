import { describe, expect, it } from "vitest";
import { buildCalculatorCsv, buildCalculatorCsvFilename, type CalculatorCsvRow } from "./calculatorCsv";

describe("buildCalculatorCsv", () => {
  it("UTF-8 BOM과 헤더로 시작하고, 각 행을 화면 표시와 동일한 포맷으로 직렬화한다", () => {
    const rows: CalculatorCsvRow[] = [
      {
        name: "허영주", role: "팀장", score: 47.3, reviewerScore: "80",
        total: 66.92, grade: "A+", isFinalPublic: true,
      },
    ];

    const csv = buildCalculatorCsv(rows);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("이름,역할,기여점수,심사자점수,총합,학점,공개여부");
    expect(lines[1]).toBe("허영주,팀장,47.30,80,66.92,A+,공개");
  });

  it("심사자 점수/총합/학점이 비어있으면 빈 문자열로 출력하고, 비공개는 '비공개'로 표시한다", () => {
    const rows: CalculatorCsvRow[] = [
      {
        name: "박상준", role: "팀원", score: 38.3, reviewerScore: "",
        total: null, grade: "", isFinalPublic: false,
      },
    ];

    const csv = buildCalculatorCsv(rows);

    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe("박상준,팀원,38.30,,,,비공개");
  });

  it("값에 쉼표나 큰따옴표가 있으면 CSV 표준에 맞게 이스케이프한다", () => {
    const rows: CalculatorCsvRow[] = [
      {
        name: '김"철,수', role: "팀원", score: 10, reviewerScore: "",
        total: null, grade: "", isFinalPublic: false,
      },
    ];

    const csv = buildCalculatorCsv(rows);

    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe('"김""철,수",팀원,10.00,,,,비공개');
  });

  it("행이 없으면 헤더만 있는 CSV를 만든다", () => {
    const csv = buildCalculatorCsv([]);

    const lines = csv.slice(1).split("\r\n");
    expect(lines).toEqual(["이름,역할,기여점수,심사자점수,총합,학점,공개여부"]);
  });
});

describe("buildCalculatorCsvFilename", () => {
  it("프로젝트명과 날짜(YYYYMMDD)를 조합한 파일명을 만든다", () => {
    const filename = buildCalculatorCsvFilename("데모 프로젝트", new Date(2026, 6, 27));

    expect(filename).toBe("데모 프로젝트_학점계산기_20260727.csv");
  });

  it("파일명에 쓸 수 없는 문자를 밑줄로 치환한다", () => {
    const filename = buildCalculatorCsvFilename('프로젝트/제목:*?"<>|', new Date(2026, 0, 5));

    expect(filename).toBe("프로젝트_제목________학점계산기_20260105.csv");
  });

  it("빈 프로젝트명이면 기본값 '프로젝트'를 쓴다", () => {
    const filename = buildCalculatorCsvFilename("", new Date(2026, 0, 5));

    expect(filename).toBe("프로젝트_학점계산기_20260105.csv");
  });
});
