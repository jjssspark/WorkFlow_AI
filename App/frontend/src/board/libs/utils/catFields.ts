import { getCat } from "./taskService";

export const CAT_MODAL_FIELDS: Record<string, [string, string][]> = {
  frontend:     [["화면 이름","구현할 화면명"],["컴포넌트","예: Header, SearchBar"],["연결 API","예: /api/v1/users"],["Figma 링크","https://figma.com/..."],["GitHub 브랜치","예: feature/user-list"]],
  backend:      [["API 이름","예: 사용자 로그인 API"],["Method","GET / POST / PUT / DELETE"],["Endpoint","예: /api/v1/auth/login"],["연결 DB 테이블","예: users, sessions"],["인증 필요 여부","필요 / 불필요"]],
  "ai-ml":      [["모델 목적","예: 주차 빈자리 예측"],["사용 데이터","예: 90일치 센서 데이터"],["모델 종류","예: Random Forest, LSTM"],["평가 지표","예: Accuracy, RMSE"],["목표 성능","예: Accuracy 90% 이상"]],
  data:         [["데이터 출처","예: CCTV 센서, 공공데이터"],["데이터 형식","예: CSV, JSON, 이미지"],["수집 목표량","예: 90일치 / 10만 건"],["전처리 방법","예: 결측치 제거, 정규화"]],
  db:           [["테이블명","예: users, spaces"],["ERD 상태","예: 설계 완료 / 수정 중"],["쿼리 이슈","예: 풀스캔 발생"],["인덱스 여부","적용 / 미적용"]],
  devops:       [["배포 환경","예: AWS EC2, Docker"],["배포 상태","예: 개발 서버 배포 완료"],["CI/CD 도구","예: GitHub Actions"]],
  github:       [["브랜치명","예: feature/payment-flow"],["PR 번호","예: PR #18"],["리뷰 상태","리뷰 대기 / 완료"],["충돌 여부","없음 / 있음"]],
  qa:           [["테스트 대상","예: 예약 API 전체"],["테스트 케이스","예: 정상 흐름, 경계값"],["기대 결과","예: 응답 2초 이내"],["테스트 방법","수동 / 자동 / 부하"]],
  security:     [["점검 대상","예: 로그인 API, 권한 검사"],["위험 수준","높음 / 중간 / 낮음"],["발견된 취약점","예: SQL Injection 가능성"],["조치 방법","예: Prepared Statement"]],
  docs:         [["문서 종류","예: README / 보고서 / 설명서"],["작성 범위","예: API 명세 전체"],["포함할 내용","예: 설치 방법, 주요 기능"]],
  presentation: [["발표 주제","예: AI 기반 스마트 주차"],["담당 파트","예: 기술 스택 소개 (3~6슬라이드)"],["PPT 페이지 수","예: 20슬라이드"],["시연 포함 여부","포함 / 미포함"]],
  deliverable:  [["산출물 종류","예: 최종 보고서, 제안서"],["제출 형식","예: PDF, DOCX"],["포함 항목","예: 목차, 결론, 부록"],["제출 마감","예: 12.28 23:59"]],
  operation:    [["제출처","예: 공모전 홈페이지, 교수 이메일"],["제출 파일","예: 보고서.pdf, 발표.pptx"],["마감 시간","예: 12.28 23:59"],["제출 상태","미제출 / 제출 완료"]],
  planning:     [["기획 목적","예: 핵심 기능 범위 확정"],["사용자 시나리오","예: 로그인 → 예약 → 결제"],["연결된 기능","예: 예약 모듈, 결제 모듈"]],
  research:     [["조사 주제","예: 경쟁 서비스 벤치마킹"],["참고 자료","논문/기사 링크"],["핵심 인사이트","조사에서 발견한 핵심 내용"]],
  "ux-ui":      [["화면 이름","설계할 화면명"],["사용자 플로우","예: 로그인 → 예약 → 결제"],["Figma 링크","https://figma.com/..."]],
  design:       [["디자인 유형","예: PPT 디자인, 로고"],["색상/폰트 가이드","예: Primary #3B5BDB, Inter"],["참고 이미지","예: Dribbble 링크"]],
  other:        [["결과물","이 업무에서 생성할 파일이나 결과물"],["완료 기준 보완","추가 완료 기준"],["참고 자료","관련 링크 또는 파일"]],
};

/**
 * 업무 생성/수정 시 입력한 카테고리별 추가 정보(extraFields)를 상세 패널에 보여줄 [라벨, 값] 목록으로 바꾼다.
 * 라벨은 CAT_MODAL_FIELDS의 라벨을 그대로 key로 써서, 입력 화면과 표시 화면이 같은 항목을 가리키게 한다.
 */
export const getCatFieldValues = (cat: string, extraFields: Record<string, string> | undefined): [string, string][] => {
  const fields = CAT_MODAL_FIELDS[cat] ?? CAT_MODAL_FIELDS.other;
  if (!fields || fields.length === 0) {
    return [["카테고리", getCat(cat).label]];
  }
  return fields.map(([label]) => [label, extraFields?.[label] || "—"]);
};

export const CAT_AI_BTN: Record<string, string> = {
  frontend:"QA 요청",backend:"API 명세 작성","ai-ml":"실험 결과 기록",
  qa:"버그 등록",docs:"AI 문장 정리",presentation:"발표 대본 생성",db:"스키마 변경 기록",default:"AI 추천 받기",
};
