import {
  Target, BookOpen, Layout, Palette, Monitor, Server, Cpu, BarChart3,
  Database, Cloud, GitBranch, FlaskConical, Shield, FileText, Layers,
  Package, CheckCheck, MoreHorizontal,
} from "lucide-react";
import type { Task, TaskStatus, CategoryDef } from "../types/task";

export const TASKS: Task[] = [
  { id: "TF-01", title: "주차 감지 센서 모듈 연동", status: "done", priority: "high", assignee: "1", dueDate: "2025-12-05", category: "backend", labels: ["개발"], position: 0, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-02", title: "사용자 인증 API 구현", status: "done", priority: "high", assignee: "3", dueDate: "2025-12-06", category: "backend", labels: ["백엔드"], position: 1, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-03", title: "실시간 주차 현황 대시보드 UI", status: "done", priority: "medium", assignee: "3", dueDate: "2025-12-08", category: "frontend", labels: ["프론트"], position: 2, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-04", title: "모바일 예약 화면 구현", status: "done", priority: "medium", assignee: "2", dueDate: "2025-12-10", category: "frontend", labels: ["프론트"], position: 3, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-05", title: "결제 시스템 연동 (카카오페이)", status: "inprogress", priority: "high", assignee: "4", dueDate: "2025-12-18", category: "backend", labels: ["백엔드"], position: 0, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-06", title: "AI 빈자리 예측 모델 학습", status: "inprogress", priority: "high", assignee: "1", dueDate: "2025-12-20", category: "ai-ml", labels: ["AI"], position: 1, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-07", title: "관리자 대시보드 통계 모듈", status: "inprogress", priority: "medium", assignee: "2", dueDate: "2025-12-19", category: "frontend", labels: ["프론트"], position: 2, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-08", title: "푸시 알림 서비스 구현", status: "inprogress", priority: "low", assignee: "4", dueDate: "2025-12-21", category: "backend", labels: ["백엔드"], position: 3, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-09", title: "최종 발표 자료 작성", status: "todo", priority: "high", assignee: "1", dueDate: "2025-12-28", category: "presentation", labels: ["산출물"], position: 0, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-10", title: "시스템 부하 테스트", status: "todo", priority: "medium", assignee: "2", dueDate: "2025-12-23", category: "qa", labels: ["QA"], position: 1, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-11", title: "README 및 배포 문서 작성", status: "todo", priority: "medium", assignee: "3", dueDate: "2025-12-25", category: "docs", labels: ["문서"], position: 2, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-12", title: "보안 취약점 점검 보고서", status: "todo", priority: "low", assignee: "4", dueDate: "2025-12-26", category: "security", labels: ["문서"], position: 3, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-13", title: "DB 인덱싱 최적화", status: "blocked", priority: "high", assignee: "1", dueDate: "2025-12-15", category: "db", labels: ["백엔드"], position: 0, pendingApproval: false, startDate: "", extraFields: {} },
  { id: "TF-14", title: "결제 오류 예외 처리", status: "blocked", priority: "high", assignee: "4", dueDate: "2025-12-16", category: "backend", labels: ["백엔드"], position: 1, pendingApproval: false, startDate: "", extraFields: {} },
];

export const TASK_SOURCES: Record<string, string> = {
  "TF-01": "직접 생성", "TF-02": "직접 생성", "TF-03": "직접 생성",
  "TF-04": "회의록 AI",  "TF-05": "회의록 AI",  "TF-06": "회의록 AI",
  "TF-07": "회의록 AI",  "TF-08": "회의록 AI",
  "TF-09": "직접 생성", "TF-10": "직접 생성", "TF-11": "직접 생성", "TF-12": "직접 생성",
  "TF-13": "GitHub",    "TF-14": "GitHub",
};

export const IN_PROGRESS_META: Record<string, { startDate: string; lastUpdate: string; stale: boolean; riskLevel: "high" | "medium" | "low"; nextAction: string; note: string }> = {
  "TF-05": { startDate: "11.28", lastUpdate: "오늘",   stale: false, riskLevel: "high",   nextAction: "SDK 충돌 이슈 해결 후 PR #18 재요청",        note: "결제 연동 블로커(BL-02) 해결 대기 중. 우선순위 1위" },
  "TF-06": { startDate: "12.02", lastUpdate: "어제",   stale: false, riskLevel: "medium", nextAction: "모델 학습 완료 후 정확도 검증 보고서 작성",    note: "현재 87% 정확도. 목표 90% 달성을 위한 추가 학습 중" },
  "TF-07": { startDate: "12.03", lastUpdate: "3일 전", stale: true,  riskLevel: "medium", nextAction: "차트 컴포넌트 API 연동 완료 및 PR 제출",       note: "3일 간 업데이트 없음. 진행 상황 확인 필요" },
  "TF-08": { startDate: "12.05", lastUpdate: "5일 전", stale: true,  riskLevel: "low",    nextAction: "FCM 토큰 발급 로직 완성 후 단위 테스트 작성",  note: "5일 간 업데이트 없음. 팀장 확인 요청 예정" },
};

export const URGENT_META: Record<string, { daysLeft: number; urgency: "overdue" | "today" | "3day" | "week" | "normal" }> = {
  "TF-05": { daysLeft: 8,  urgency: "week" },
  "TF-06": { daysLeft: 10, urgency: "week" },
  "TF-07": { daysLeft: 9,  urgency: "week" },
  "TF-08": { daysLeft: 11, urgency: "week" },
  "TF-09": { daysLeft: 18, urgency: "normal" },
  "TF-10": { daysLeft: 13, urgency: "week" },
  "TF-11": { daysLeft: 15, urgency: "normal" },
  "TF-12": { daysLeft: 16, urgency: "normal" },
  "TF-13": { daysLeft: 5,  urgency: "3day" },
  "TF-14": { daysLeft: 6,  urgency: "3day" },
};

export const CATEGORIES: CategoryDef[] = [
  { id:"planning",     label:"기획",       desc:"요구사항 정리, 기능 정의, 일정",      icon:Target,         color:"#6366F1", bg:"rgba(99,102,241,0.12)"  },
  { id:"research",     label:"리서치",     desc:"시장조사, 논문, 경쟁 서비스 분석",    icon:BookOpen,       color:"#8B5CF6", bg:"rgba(139,92,246,0.12)"  },
  { id:"ux-ui",        label:"UX/UI",      desc:"와이어프레임, 사용자 흐름, 화면 설계", icon:Layout,        color:"#EC4899", bg:"rgba(236,72,153,0.12)"  },
  { id:"design",       label:"디자인",     desc:"시각 디자인, 포스터, 발표자료",       icon:Palette,        color:"#F43F5E", bg:"rgba(244,63,94,0.12)"   },
  { id:"frontend",     label:"프론트엔드", desc:"화면 구현, 컴포넌트 개발, 반응형",   icon:Monitor,        color:"#3B5BDB", bg:"rgba(59,91,219,0.12)"   },
  { id:"backend",      label:"백엔드",     desc:"API, 서버 로직, 인증, 권한",         icon:Server,         color:"#0EA5E9", bg:"rgba(14,165,233,0.12)"  },
  { id:"ai-ml",        label:"AI/ML",      desc:"모델 설계, 학습, 추론 알고리즘",     icon:Cpu,            color:"#10B981", bg:"rgba(16,185,129,0.12)"  },
  { id:"data",         label:"데이터",     desc:"수집, 전처리, 라벨링, EDA",          icon:BarChart3,      color:"#14B8A6", bg:"rgba(20,184,166,0.12)"  },
  { id:"db",           label:"DB",         desc:"테이블 설계, ERD, 쿼리 최적화",      icon:Database,       color:"#7C3AED", bg:"rgba(124,58,237,0.12)"  },
  { id:"devops",       label:"DevOps",     desc:"배포, 서버 설정, CI/CD",             icon:Cloud,          color:"#F59E0B", bg:"rgba(245,158,11,0.12)"  },
  { id:"github",       label:"GitHub",     desc:"브랜치, PR, 코드리뷰, 충돌 해결",   icon:GitBranch,      color:"#374151", bg:"rgba(55,65,81,0.12)"    },
  { id:"qa",           label:"QA/테스트",  desc:"기능 테스트, 버그 리포트, 성능",     icon:FlaskConical,   color:"#F97316", bg:"rgba(249,115,22,0.12)"  },
  { id:"security",     label:"보안",       desc:"취약점 점검, 인증/인가, 접근 제어",  icon:Shield,         color:"#DC2626", bg:"rgba(220,38,38,0.12)"   },
  { id:"docs",         label:"문서",       desc:"README, 보고서, 회의록, 설명서",     icon:FileText,       color:"#6B7280", bg:"rgba(107,114,128,0.12)" },
  { id:"presentation", label:"발표",       desc:"PPT, 발표 대본, 시연 준비",          icon:Layers,         color:"#D946EF", bg:"rgba(217,70,239,0.12)"  },
  { id:"deliverable",  label:"산출물",     desc:"최종 보고서, 제안서, 제출 파일",     icon:Package,        color:"#0F766E", bg:"rgba(15,118,110,0.12)"  },
  { id:"operation",    label:"운영/제출",  desc:"공모전 제출, 교수 제출, 마감 체크",  icon:CheckCheck,     color:"#059669", bg:"rgba(5,150,105,0.12)"   },
  { id:"other",        label:"기타",       desc:"직접 카테고리명 입력",               icon:MoreHorizontal, color:"#9CA3AF", bg:"rgba(156,163,175,0.12)" },
];

export const BOARD_COLS = [
  { id:"todo"       as TaskStatus, label:"할 일",       color:"#8892A4", bg:"#F4F6FA" },
  { id:"inprogress" as TaskStatus, label:"진행 중",     color:"#3B5BDB", bg:"#EEF1FB" },
  { id:"blocked"    as TaskStatus, label:"보류/블로커", color:"#EF4444", bg:"#FEF2F2" },
  { id:"done"       as TaskStatus, label:"완료",        color:"#10B981", bg:"#ECFDF5" },
];
