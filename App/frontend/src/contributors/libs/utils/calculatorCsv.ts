// 학점 계산기 테이블(ContributorsView 우측 카드)을 CSV로 내보내는 순수 유틸.
// 서버 호출 없이 화면에 이미 렌더링된 행 데이터를 그대로 문자열로 직렬화한다.

export interface CalculatorCsvRow {
  name: string;
  role: string;
  score: number; // 기여 점수
  reviewerScore: string; // 학점 계산기 입력값 — 비어있으면 빈 문자열
  total: number | null; // null이면 아직 계산 안 됨(심사자 점수 미입력)
  grade: string; // 선택 안 했으면 빈 문자열
  isFinalPublic: boolean;
}

const CSV_HEADERS = ["이름", "역할", "기여점수", "심사자점수", "총합", "학점", "공개여부"];

// 엑셀에서 UTF-8 CSV를 열 때 한글이 깨지지 않도록 붙이는 BOM(byte order mark).
const UTF8_BOM = "﻿";

// CSV 표준(RFC 4180)에 맞춰 쉼표/줄바꿈/큰따옴표가 든 값만 큰따옴표로 감싸고 이스케이프한다.
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** 학점 계산기 행 목록을 CSV 문자열로 직렬화한다(엑셀 호환을 위한 UTF-8 BOM 포함). */
export function buildCalculatorCsv(rows: CalculatorCsvRow[]): string {
  const lines = [
    toCsvRow(CSV_HEADERS),
    ...rows.map((row) =>
      toCsvRow([
        row.name,
        row.role,
        row.score.toFixed(2),
        row.reviewerScore,
        row.total != null ? row.total.toFixed(2) : "",
        row.grade,
        row.isFinalPublic ? "공개" : "비공개",
      ]),
    ),
  ];
  return UTF8_BOM + lines.join("\r\n");
}

// 파일명에 쓸 수 없는 문자(윈도우 기준 \/:*?"<>|)를 밑줄로 치환한다.
function sanitizeForFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** "{프로젝트명}_학점계산기_{YYYYMMDD}.csv" 형식의 파일명을 만든다. */
export function buildCalculatorCsvFilename(projectTitle: string, date: Date): string {
  const safeTitle = sanitizeForFilename(projectTitle) || "프로젝트";
  return `${safeTitle}_학점계산기_${formatDate(date)}.csv`;
}

/** CSV 문자열을 파일로 즉시 다운로드시킨다(브라우저 환경 전용, 부수효과 함수). */
export function downloadCalculatorCsv(rows: CalculatorCsvRow[], projectTitle: string): void {
  const csv = buildCalculatorCsv(rows);
  const filename = buildCalculatorCsvFilename(projectTitle, new Date());
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
