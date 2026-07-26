import { Suspense, useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { AIAssistant } from "../../../ai/screen/AIAssistant";
import {
  OPEN_AI_ASSISTANT_EVENT,
  type OpenAIAssistantEventDetail,
} from "../../../ai/libs/utils/openAIAssistant";
import type { Tab } from "../../../board/libs/types/task";
import { useAuth } from "../../hooks/useAuth";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { useDraggableFab } from "../../hooks/useDraggableFab";
import { useIsMobile } from "../ui/use-mobile";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectRoles } = useAuth();
  const [aiOpen, setAIOpen] = useState(false);
  // 닫혀 있는 동안 답변이 도착했는지. 창을 열면 곧 읽게 되므로 그때 지운다.
  const [unreadAnswer, setUnreadAnswer] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<OpenAIAssistantEventDetail | null>(null);
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapsed();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => sessionStorage.getItem("pendingInvite"));

  useEffect(() => {
    setMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as OpenAIAssistantEventDetail | undefined
        : undefined;
      setPendingQuestion(detail ?? null);
      setUnreadAnswer(false);
      setAIOpen(true);
    };
    window.addEventListener(OPEN_AI_ASSISTANT_EVENT, open);
    return () => window.removeEventListener(OPEN_AI_ASSISTANT_EVENT, open);
  }, []);

  const openAI = () => {
    setPendingQuestion(null);
    setUnreadAnswer(false);
    setAIOpen(true);
  };

  const closeAI = () => {
    setAIOpen(false);
    setPendingQuestion(null);
  };

  // 패널은 닫혀도 언마운트되지 않으므로 리스너를 열림 상태와 묶는다. 그러지 않으면 다른
  // 화면에서 누른 Esc까지 숨어 있는 패널이 가로챈다.
  useEffect(() => {
    if (!aiOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeAI();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [aiOpen]);

  const assistantFab = useDraggableFab(openAI);

  const activeTab = (location.pathname.split("/").filter(Boolean)[0] ?? "dashboard") as Tab;
  const isJudge = projectRoles.length > 0 && projectRoles.every(pr => pr.role === "심사자");
  const isReadOnlyContent = isJudge && activeTab !== "contributors";

  const blockReadOnlyAction = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const interactive = target?.closest("button, a, input, textarea, select, [role='button']");
    if (interactive) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleSelect = (tab: Tab) => {
    navigate(`/${tab}`);
    setMobileOpen(false);
  };

  const acceptPendingInvite = () => {
    if (!pendingInvite) return;
    navigate(pendingInvite);
    setPendingInvite(null);
  };

  const dismissPendingInvite = () => {
    sessionStorage.removeItem("pendingInvite");
    setPendingInvite(null);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <div
        data-sidebar-wrapper
        className={
          isMobile
            ? `fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`
            : ""
        }
        {...(isMobile && !mobileOpen ? { "aria-hidden": true, inert: true } : {})}
      >
        <Sidebar
          active={activeTab}
          onSelect={handleSelect}
          onAI={openAI}
          collapsed={isMobile ? false : collapsed}
          onToggleCollapsed={toggleCollapsed}
          showCollapseToggle={!isMobile}
        />
      </div>
      {isMobile && mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileOpen(true)} />

        {/* Content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {pendingInvite && (
            <div className="shrink-0 px-6 py-2.5 border-b border-blue-100 bg-blue-50 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-blue-700">참여 대기 중인 초대가 있습니다.</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={acceptPendingInvite}
                  className="px-3 py-1 rounded text-xs font-semibold text-white"
                  style={{ background: "#3B5BDB" }}
                >
                  참여하기
                </button>
                <button
                  type="button"
                  onClick={dismissPendingInvite}
                  aria-label="초대 안내 닫기"
                  className="px-2 py-1 rounded text-xs text-blue-700 hover:bg-blue-100"
                >
                  닫기
                </button>
              </div>
            </div>
          )}
          {isReadOnlyContent && (
            <div className="shrink-0 px-6 py-2.5 border-b border-violet-100 bg-violet-50 text-xs font-semibold text-violet-700">
              심사자 열람 전용 모드입니다. 프로젝트 정보는 확인만 가능하며 수정, 등록, 업로드 액션은 비활성화됩니다.
            </div>
          )}
          <div
            className="flex-1 min-h-0 overflow-hidden"
            onClickCapture={isReadOnlyContent ? blockReadOnlyAction : undefined}
            onKeyDownCapture={isReadOnlyContent ? blockReadOnlyAction : undefined}
          >
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">로딩 중...</div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {/* AI floating button */}
      {!isJudge && !aiOpen && (
        <button {...assistantFab.handlers}
          aria-label="AI 어시스턴트 열기 (끌어서 위치 이동)"
          className={`fixed w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center text-white transition-transform z-40 ${
            assistantFab.isDragging ? "cursor-grabbing" : "cursor-grab hover:scale-105"
          }`}
          style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)", ...assistantFab.style }}>
          <Sparkles className="w-6 h-6 pointer-events-none" />
          {unreadAnswer && (
            <span aria-label="읽지 않은 답변 있음"
              className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white pointer-events-none" />
          )}
        </button>
      )}

      {/* AI panel overlay */}
      {/* 패널은 닫혀도 언마운트하지 않는다. 언마운트하면 진행 중인 답변 요청이 함께 끊긴다.
          가림막만 열려 있을 때 띄운다. */}
      {!isJudge && (
        <>
          {aiOpen && <div className="fixed inset-0 bg-black/10 z-40" onClick={closeAI} />}
          <AIAssistant
            onClose={closeAI}
            pendingQuestion={pendingQuestion}
            isOpen={aiOpen}
            onAnswerWhileClosed={() => setUnreadAnswer(true)}
          />
        </>
      )}
    </div>
  );
}
