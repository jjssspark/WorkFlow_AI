// REVIEWER_TEAMS는 ReviewerMyPage(Task 5)에서는 더 이상 쓰지 않지만
// ContributorsView.tsx가 여전히 참조하므로 유지한다(범위 밖 화면).
export const REVIEWER_TEAMS = [
  { id: "T1", name: "스마트 주차 관리 시스템", leader: "김민준", members: 4, progress: 71, evalStatus: "evaluating" as const, deliverables: 3, github: true, submitted: 2, type: "캡스톤" },
  { id: "T2", name: "AI 기반 식단 추천 앱", leader: "정민아", members: 3, progress: 54, evalStatus: "pending" as const, deliverables: 1, github: true, submitted: 0, type: "캡스톤" },
  { id: "T3", name: "실시간 버스 도착 알리미", leader: "이준혁", members: 5, progress: 88, evalStatus: "published" as const, deliverables: 5, github: true, submitted: 5, type: "캡스톤" },
  { id: "T4", name: "스터디 매칭 플랫폼", leader: "최지현", members: 4, progress: 42, evalStatus: "pending" as const, deliverables: 0, github: false, submitted: 0, type: "캡스톤" },
];

export const CONTRIB_REPORTS = [
  { memberId:"1", name:"김민준", role:"팀장", color:"#3B5BDB", todoDone:8, todoTotal:10, meetings:6, commits:35, prs:6,
    aiSummary:"팀장으로서 프로젝트 전반을 이끌며 AI 모델 개발에 집중 기여. 업무 완료율 80%, 커밋 비중 최고.",
    evidence:["To-Do #3,#6,#9,#12", "PR #5,#9,#14", "12.10 회의록"], score:92, isPublic:true,
    categories:{ task:85, meeting:90, workload:78 } },
  { memberId:"2", name:"이서연", role:"팀원", color:"#7048E8", todoDone:3, todoTotal:3, meetings:6, commits:18, prs:4,
    aiSummary:"프론트엔드 전반 담당. UI/UX 설계와 발표자료 준비에 기여. 회의 참석률 100%.",
    evidence:["To-Do #4,#7", "PR #12,#17", "11.26, 12.10 회의록"], score:88, isPublic:false,
    categories:{ task:100, meeting:100, workload:82 } },
  { memberId:"3", name:"박지수", role:"팀원", color:"#10B981", todoDone:3, todoTotal:3, meetings:5, commits:22, prs:5,
    aiSummary:"백엔드 API와 DB 설계 주도. 안정적 서버 환경 구축. 문서화 작업 적극 참여.",
    evidence:["To-Do #2,#11", "PR #8,#13", "12.03 회의록"], score:85, isPublic:false,
    categories:{ task:100, meeting:83, workload:75 } },
  { memberId:"4", name:"최동혁", role:"팀원", color:"#F59E0B", todoDone:1, todoTotal:3, meetings:4, commits:12, prs:3,
    aiSummary:"결제 연동 개발 중 블로커 이슈 발생으로 일정 지연. 현재 적극 해결 중. 개발 의지 높음.",
    evidence:["To-Do #5,#14", "PR #18(진행중)", "12.10 회의록 블로커 언급"], score:72, isPublic:false,
    categories:{ task:33, meeting:67, workload:60 } },
];
