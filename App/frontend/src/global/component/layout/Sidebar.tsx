import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronDown, Hash, Plus, Sparkles, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS } from "../../lib/constants/nav";
import type { Tab } from "../../../board/libs/types/task";
import { useAuth } from "../../hooks/useAuth";
import type { ProjectRoleKo } from "../../api/authTypes";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { usePendingApprovalCount } from "../../../leader/libs/hooks/usePendingApprovalCount";
import { InviteCodeSection } from "./InviteCodeSection";

const ROLE_COLORS: Record<ProjectRoleKo, string> = {
  "팀장": "#3B5BDB",
  "팀원": "#10B981",
  "심사자": "#7048E8",
};

interface SidebarProps {
  active: Tab;
  onSelect: (t: Tab) => void;
  onAI: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showCollapseToggle: boolean;
}

export function Sidebar({ active, onSelect, onAI, collapsed, onToggleCollapsed, showCollapseToggle }: SidebarProps) {
  const groups: Record<string, string> = { planning: "계획 관리", ai: "AI 기능", dev: "개발", eval: "평가 (심사자 전용)", me: "내 계정" };
  const rendered: string[] = [];
  const navigate = useNavigate();
  const { user, projectRoles, currentProjectId, currentProject, selectProject } = useAuth();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const currentProjectName = currentProject?.projectTitle ?? null;
  // 기본값을 "팀장"으로 두면 프로젝트가 아직 선택되지 않은 순간에 팀장 전용 메뉴와 초대 코드가
  // 노출된다(라우트 가드는 막지만 화면은 이미 보인 뒤다). 권한 판정과 같은 순서로 폴백하고,
  // 그래도 모르면 최소 권한인 "팀원"으로 둔다 - useAuthGuard.RequireRole 참고.
  const role: ProjectRoleKo = currentProject?.role ?? projectRoles[0]?.role ?? "팀원";
  const pendingApprovalCount = usePendingApprovalCount(currentProjectId, role === "팀장");
  const navItems = NAV_ITEMS.filter((item) => {
    if (item.activate === false) return false;
    if (item.id === "contributors") return role === "심사자";
    if (item.id === "leader") return role === "팀장";
    return true;
  });

  return (
    <div
      className="shrink-0 flex flex-col h-full overflow-hidden transition-[width] duration-200 ease-in-out"
      style={{ background: "var(--sidebar)", fontFamily: "'Inter', 'Noto Sans KR', sans-serif", width: collapsed ? "64px" : "220px" }}
    >
      {/* Logo */}
      <div className="px-5 pt-6 pb-4 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: "var(--sidebar-primary)" }}>
          TF
        </div>
        {!collapsed && (
          <div>
            <div className="text-white font-semibold text-sm leading-none whitespace-nowrap">TeamFlow</div>
            <div className="text-[10px] font-medium mt-0.5 whitespace-nowrap" style={{ color: "var(--accent)" }}>AI Powered</div>
          </div>
        )}
      </div>

      {/* Project selector */}
      <div className="relative mx-3 mb-4">
        <button
          onClick={() => setProjectMenuOpen((o) => !o)}
          aria-label="프로젝트 선택"
          className={`w-full flex items-center gap-2 rounded-lg text-left transition-colors ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"}`}
          style={{ background: "var(--sidebar-accent)" }}
        >
          <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center shrink-0">
            <Hash className="w-3 h-3 text-white" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{currentProjectName || "스마트 주차 관리"}</div>
              <div className="text-[10px] flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                <span>{[currentProject?.type, currentProject?.year].filter(Boolean).join(" ") || "프로젝트 정보 없음"}</span>
                <span className="px-1.5 py-0.5 rounded font-semibold" style={{ color: "#fff", background: ROLE_COLORS[role] }}>
                  {role}
                </span>
              </div>
            </div>
          )}
          {!collapsed && (
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${projectMenuOpen ? "rotate-180" : ""}`}
              style={{ color: "var(--muted-foreground)" }}
            />
          )}
        </button>

        {projectMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(false)} />
            <div
              className={`absolute left-0 top-full mt-1.5 rounded-lg border shadow-lg z-50 overflow-hidden ${collapsed ? "w-64" : "w-full"}`}
              style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}
            >
              <div className="max-h-64 overflow-y-auto py-1">
                {projectRoles.length === 0 ? (
                  <div className="px-3 py-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    생성된 프로젝트가 없습니다.
                  </div>
                ) : (
                  projectRoles.map((pr) => {
                    const isSelected = pr.projectId === currentProjectId;
                    return (
                      <button
                        key={pr.projectId}
                        onClick={() => { selectProject(pr.projectId); setProjectMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
                        style={{ background: isSelected ? "var(--sidebar-accent)" : "transparent" }}
                      >
                        <span className="flex-1 min-w-0 text-xs font-medium text-white truncate">
                          {pr.projectTitle || "제목 없음"}
                        </span>
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                          style={{ color: "#fff", background: ROLE_COLORS[pr.role] }}
                        >
                          {pr.role}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                      </button>
                    );
                  })
                )}
              </div>
              {role === "팀장" && currentProjectId !== null && (
                <InviteCodeSection projectId={currentProjectId} />
              )}
              <div className="border-t" style={{ borderColor: "var(--sidebar-border)" }}>
                <button
                  onClick={() => { setProjectMenuOpen(false); navigate("/onboarding"); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                  style={{ color: "var(--accent)" }}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs font-medium">새 프로젝트 만들기</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-0.5 scrollbar-thin-dark">
        {navItems.map((item) => {
          const showGroup = !collapsed && !rendered.includes(item.group);
          if (showGroup) rendered.push(item.group);
          const isActive = active === item.id;
          const badgeText =
            item.id === "leader" && pendingApprovalCount > 0 ? String(pendingApprovalCount) : item.badge;

          const button = (
            <button
              onClick={() => onSelect(item.id as Tab)}
              aria-label={item.label}
              className={`w-full flex items-center gap-2.5 rounded-lg text-left transition-all text-sm ${collapsed ? "justify-center px-2 py-2" : "px-3 py-2"} ${isActive ? "text-white" : "hover:text-white"}`}
              style={{
                background: isActive ? "var(--sidebar-primary)" : "transparent",
                color: isActive ? "white" : "var(--sidebar-foreground)",
              }}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
              {!collapsed && badgeText && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(112,72,232,0.3)", color: "#A78BFA" }}>
                  {badgeText}
                </span>
              )}
            </button>
          );

          return (
            <div key={item.id}>
              {showGroup && (
                <div className="text-[10px] font-semibold uppercase tracking-wider px-2 pt-4 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                  {groups[item.group]}
                </div>
              )}
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                button
              )}
            </div>
          );
        })}

        {/* AI Assistant button */}
        {role !== "심사자" && (
          <div className="pt-4">
            {!collapsed && (
              <div className="text-[10px] font-semibold uppercase tracking-wider px-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                어시스턴트
              </div>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onAI}
                    aria-label="AI 어시스턴트"
                    className="w-full flex items-center justify-center px-2 py-2 rounded-lg transition-all text-sm text-white"
                    style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">AI 어시스턴트</TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={onAI}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all text-sm text-white"
                style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="font-medium">AI 어시스턴트</span>
              </button>
            )}
          </div>
        )}
      </nav>

      {/* Collapse toggle */}
      {showCollapseToggle && (
        <div className="px-3 pt-2 pb-1 border-t" style={{ borderColor: "var(--sidebar-border)" }}>
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            className={`w-full flex items-center gap-2.5 py-2 rounded-lg transition-colors hover:bg-white/5 ${collapsed ? "justify-center px-2" : "px-2"}`}
            style={{ color: "var(--muted-foreground)" }}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4 shrink-0" /> : <PanelLeftClose className="w-4 h-4 shrink-0" />}
            {!collapsed && <span className="text-xs font-medium">접기</span>}
          </button>
        </div>
      )}

      {/* User */}
      <div className="p-3 border-t" style={{ borderColor: "var(--sidebar-border)" }}>
        <div className={`flex items-center gap-2.5 px-2 py-1.5 ${collapsed ? "justify-center" : ""}`}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0" style={{ background: "#3B5BDB" }}>
              {(user?.name || "사용자").charAt(0)}
            </div>
          )}
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">{user?.name || "사용자"}</div>
              <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{role}</div>
            </div>
          )}
          {!collapsed && (
            <button type="button" onClick={() => navigate("/mypage/settings")} aria-label="개인정보 수정">
              <Settings className="w-4 h-4 cursor-pointer shrink-0 hover:text-white transition-colors" style={{ color: "var(--muted-foreground)" }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
