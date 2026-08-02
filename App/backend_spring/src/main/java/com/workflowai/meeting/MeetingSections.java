package com.workflowai.meeting;

/**
 * 서비스가 제공한 회의록 양식으로 작성된 문서에서 뽑아낸 섹션 본문.
 *
 * <p>"회의 개요"와 "다음 회의"는 양식 인식에만 쓰고 본문은 담지 않는다. 회의명·일시·참석자는
 * 업로드 모달 입력값이 단일 출처이고(참석자는 프로젝트 멤버 ID로 관리되어야 참석률 통계가 유지된다),
 * 다음 회의 안건은 분석 결과에 대응되는 항목이 없기 때문이다.
 */
public record MeetingSections(
    String discussion,
    String decisions,
    String todos,
    String issues
) {}
