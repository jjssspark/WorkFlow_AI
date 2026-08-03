/** 서비스가 제공하는 회의록 양식. 이 양식으로 작성된 문서는 백엔드가 섹션을 인식해 분석 범위를 좁힌다. */

/** 정적 경로는 ASCII로 둔다 — 개발 서버와 nginx의 URL 인코딩 처리가 갈리기 때문. */
export const MEETING_TEMPLATE_URL = "/templates/meeting-minutes-template.docx";

/** 사용자가 실제로 내려받는 파일명. <a download> 속성이 지정한다. */
export const MEETING_TEMPLATE_FILE_NAME = "회의록_양식.docx";
