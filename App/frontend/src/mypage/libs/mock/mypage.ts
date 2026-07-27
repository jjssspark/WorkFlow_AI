export const MEMBER_USER = {
  name: "이서연", email: "seo.yeon@university.ac.kr",
  affiliation: "컴퓨터공학과 3학년", field: "프론트엔드 / UX 설계",
  project: "스마트 주차 관리 시스템", github: "seo-yeon-dev",
  initials: "이", color: "#7048E8", joinedAt: "2024.09.15",
};

export const MY_ACTIVITIES = [
  { type: "merge", msg: "PR #17 머지: 모바일 예약 화면 UI 완성", time: "어제" },
  { type: "commit", msg: "feat: 관리자 통계 차트 컴포넌트 추가", time: "5시간 전" },
  { type: "comment", msg: "TF-11 README 작성 방향 코멘트 남김", time: "어제" },
  { type: "meeting", msg: "6차 정기 회의 참석", time: "12.10" },
  { type: "file", msg: "발표자료 초안 PPT 파일 업로드", time: "2일 전" },
  { type: "pr", msg: "PR #12: 실시간 대시보드 UI 생성", time: "3일 전" },
];

export const MY_FEEDBACKS = [
  { from: "김민준 (팀장)", date: "12.10", content: "모바일 화면 UI 퀄리티가 좋습니다. 예약 플로우가 직관적으로 잘 구현되었어요.", isPublic: true, type: "leader" },
  { from: "AI 활동 분석", date: "12.09", content: "이번 주 PR 2건을 머지하고 회의록 To-Do를 90% 이상 완수했습니다.", isPublic: true, type: "ai" },
];
