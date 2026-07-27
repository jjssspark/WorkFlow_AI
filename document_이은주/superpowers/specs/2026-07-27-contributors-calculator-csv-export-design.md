# 학점 계산기 CSV 내보내기

## 배경

기여도 분석 화면(`ContributorsView.tsx`)의 "PDF 저장" 버튼은 `onClick` 핸들러가
없는 껍데기 버튼이었다. 팀 논의 결과 PDF보다는 CSV/XLSX처럼 표 형태 데이터를
바로 열어볼 수 있는 포맷이 심사자에게 더 유용하고, 구현이 복잡한 기능은
빼자는 방향으로 정리됐다. 화면 전체(기여도 테이블 + 학점 계산기 + 코멘트 등)를
다 담을 필요 없이, 우측 "학점 계산기" 카드(이름/역할/기여점수/심사자점수/총합/
학점/공개여부)만 내려받을 수 있으면 충분하다.

## 범위

- "PDF 저장" 버튼을 "CSV 저장"으로 바꾸고, 클릭 시 학점 계산기 테이블을
  CSV 파일로 즉시 다운로드한다.
- 서버 API를 새로 만들지 않는다 — 이미 화면에 렌더링된 `calculatorRows`/
  `finalPublicFlags` 상태를 그대로 직렬화한다(서버 왕복 없음, 항상 최신
  화면 상태와 일치).
- XLSX(진짜 엑셀 파일)는 이번 범위에 포함하지 않는다 — 새 라이브러리
  의존성 없이 브라우저 내장 API만으로 구현 가능한 CSV를 우선한다.
- 열 구성은 학점 계산기 테이블과 1:1 대응: `이름, 역할, 기여점수, 심사자점수,
  총합, 학점, 공개여부`. 정렬 순서도 화면에 보이는 그대로(계산기의 총합
  정렬 상태 반영) 내려받는다.

## 데이터/포맷

- 기여점수: `row.score.toFixed(2)` — 화면 표시와 동일.
- 심사자점수: `row.draft.reviewerScore` — 입력 안 했으면 빈 문자열 그대로
  (화면의 "-" placeholder는 CSV에는 옮기지 않는다. 스프레드시트에서 순수
  숫자 열로 다루기 유리하도록).
- 총합: `row.total != null ? row.total.toFixed(2) : ""` — 심사자점수
  미입력이면 계산 자체가 안 되므로(`calculateTotal`이 null 반환) 빈 문자열.
- 학점: `row.draft.grade` — 선택 안 했으면 빈 문자열.
- 공개여부: `finalPublicFlags[row.memberId]`가 true면 "공개", 아니면(값이
  없는 경우 포함) "비공개".
- 엑셀에서 한글이 깨지지 않도록 파일 맨 앞에 UTF-8 BOM(`﻿`)을 붙인다.
- 값에 쉼표(`,`)/줄바꿈(`\n`)/큰따옴표(`"`)가 있으면 RFC 4180 표준에 맞춰
  큰따옴표로 감싸고 내부 큰따옴표는 두 번 반복(`""`)해 이스케이프한다.
- 줄바꿈은 `\r\n`(CRLF) — 엑셀·구글시트 모두 이 관례를 기대한다.

## 파일명

`{프로젝트명}_학점계산기_{YYYYMMDD}.csv` (예: `데모 프로젝트_학점계산기_20260727.csv`).
날짜는 다운로드 시점의 로컬 날짜. 프로젝트명에 파일명으로 쓸 수 없는 문자
(`\ / : * ? " < > |`)가 있으면 밑줄로 치환한다. 프로젝트명이 비어있으면
기본값 "프로젝트"를 쓴다.

## 아키텍처

새 파일 `App/frontend/src/contributors/libs/utils/calculatorCsv.ts`를
만든다(기존 `contributorsApi.ts`와 같은 폴더지만, API 호출이 아니라 순수
직렬화/다운로드 로직이므로 별도 파일로 분리):

- `buildCalculatorCsv(rows: CalculatorCsvRow[]): string` — 순수 함수. 행
  배열을 BOM + CSV 문자열로 변환. 단위 테스트 대상.
- `buildCalculatorCsvFilename(projectTitle: string, date: Date): string` —
  순수 함수. 파일명 생성. `date`를 인자로 받아 테스트에서 결정론적으로
  검증 가능하게 한다.
- `downloadCalculatorCsv(rows: CalculatorCsvRow[], projectTitle: string): void` —
  부수효과 함수. 위 두 순수 함수를 조합해 `Blob` + `URL.createObjectURL` +
  임시 `<a download>` 클릭으로 브라우저 다운로드를 트리거한다. 브라우저
  환경 전용이라 별도 단위 테스트 없이 `ContributorsView.test.tsx`에서
  모킹해 "버튼 클릭 시 올바른 인자로 호출됐는지"만 검증한다.

`CalculatorCsvRow` 인터페이스로 `ContributorsView`의 `calculatorRows`
내부 형태(`report & draft & total`)와 결합도를 낮춘다 — 화면 컴포넌트가
호출부에서 필요한 필드만 뽑아 넘긴다.

### `ContributorsView.tsx` 변경

- `downloadCalculatorCsv`를 import.
- 새 핸들러 `handleDownloadCsv`: `calculatorRows`를 `CalculatorCsvRow[]`로
  매핑(`finalPublicFlags[row.memberId] ?? false`로 공개 여부 조회)해
  `downloadCalculatorCsv(rows, project?.title ?? "프로젝트")` 호출.
- "PDF 저장" 버튼의 라벨을 "CSV 저장"으로, `onClick={handleDownloadCsv}`
  연결. 아이콘(`Download`)은 그대로 재사용.

## 에러 처리

없음 — 순수 클라이언트 로직이라 실패할 서버 호출이 없다. `calculatorRows`가
빈 배열이어도(팀원 없음) 헤더만 있는 CSV가 정상적으로 만들어진다.

## 테스트 계획

- `calculatorCsv.test.ts` (신규): `buildCalculatorCsv`가 BOM/헤더/행
  포맷/빈값 처리/쉼표·큰따옴표 이스케이프/빈 배열을 올바르게 처리하는지,
  `buildCalculatorCsvFilename`이 정상 케이스/특수문자 치환/빈 제목
  기본값을 올바르게 처리하는지 각각 검증.
- `ContributorsView.test.tsx`: "CSV 저장" 버튼 클릭 시 `downloadCalculatorCsv`
  가 화면에 보이는 학점 계산기 행(이름/역할/기여점수/심사자점수/총합/학점/
  공개여부)과 프로젝트명을 정확히 인자로 받아 호출되는지 검증(모킹).
