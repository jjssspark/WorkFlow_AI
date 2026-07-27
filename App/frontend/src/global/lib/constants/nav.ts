import {
  LayoutDashboard, Columns3, ClipboardCheck, FileAudio, Package, Github, Shield, User,
} from "lucide-react";
import type { Tab } from "../../../board/libs/types/task";

export const NAV_ITEMS = [
  { id: "dashboard", label: "대시보드", icon: LayoutDashboard, group: "planning" },
  { id: "board", label: "업무 보드", icon: Columns3, group: "planning" },
  { id: "leader", label: "팀장페이지", icon: ClipboardCheck, group: "planning" },
  { id: "meetings", label: "회의록 AI", icon: FileAudio, group: "ai", badge: "AI" },
  { id: "deliverables", label: "산출물 생성", icon: Package, group: "ai", badge: "AI", activate: false },
  { id: "github", label: "GitHub 연동", icon: Github, group: "dev", activate: false },
  { id: "contributors", label: "기여도 분석", icon: Shield, group: "eval", lock: true },
  { id: "mypage",       label: "마이페이지",  icon: User,   group: "me" },
];

export const TAB_TITLES: Record<Tab, string> = {
  dashboard: "대시보드",
  board: "업무 보드",
  "completion-approvals": "완료 승인",
  roadmap: "로드맵",
  leader: "팀장페이지",
  meetings: "회의록 AI",
  deliverables: "산출물 생성",
  github: "GitHub 연동",
  contributors: "기여도 분석",
  mypage: "마이페이지",
};
