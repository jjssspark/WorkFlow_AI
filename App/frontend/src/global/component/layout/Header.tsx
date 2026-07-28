import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronRight, Search, Calendar, Bell, LogOut, Menu } from "lucide-react";
import { TAB_TITLES } from "../../lib/constants/nav";
import type { Tab } from "../../../board/libs/types/task";
import {
  ACTION_REQUIRED_NOTIFICATION_TYPES, fetchNotifications, markNotificationsRead, meetingNotificationPanelQuery,
  MEETING_SHORTCUT_NOTIFICATION_TYPES,
  type NotificationResponse,
} from "../../api/notificationApi";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../hooks/useNotifications";
import { usePresence } from "../../hooks/usePresence";
import { useProject } from "../../hooks/useProject";
import type { ProjectRoleKo } from "../../api/authTypes";
import { useIsMobile } from "../ui/use-mobile";

const ROLE_COLORS: Record<ProjectRoleKo, string> = {
  "팀장": "#3B5BDB",
  "팀원": "#10B981",
  "심사자": "#7048E8",
};

function computeDDay(deadline: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "D-Day";
  return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
}

const DETAIL_TITLES: Record<string, string> = {
  "all-tasks": "전체 업무 관리", "progress": "진행률 분석",
  "blockers": "블로커 관리", "inprogress": "진행 중 업무",
  "dash-progress": "전체 진행률", "urgent": "마감 임박 업무",
  "workload": "팀원별 업무량", "activity": "최근 활동",
};

const LEADER_DETAIL_TITLES: Record<string, string> = {
  roadmap: "로드맵",
  "completion-approvals": "완료승인 대기",
};

export function Header({ onOpenMobileMenu }: { onOpenMobileMenu?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { currentProject, currentProjectId, logout } = useAuth();
  const { unreadCount, refreshUnreadCount } = useNotifications();
  const presenceUsers = usePresence(currentProjectId);
  const projectDetail = useProject(currentProjectId);
  const currentProjectName = currentProject?.projectTitle ?? null;
  const dDay = projectDetail?.deadline ? computeDDay(projectDetail.deadline) : null;
  const role: ProjectRoleKo = currentProject?.role ?? "팀장";
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [notifError, setNotifError] = useState(false);

  // 프로젝트를 전환하면 이전 프로젝트의 알림 목록이 남아있으면 안 된다 -
  // 다음 목록을 불러오기 전까지 잠깐이라도 다른 프로젝트의 알림이 화면에 보이게 된다.
  useEffect(() => {
    setNotifications([]);
    setNotifError(false);
  }, [currentProjectId]);

  // fetchNotifications 응답이 도착하기 전에 프로젝트를 전환하면, 이전 프로젝트로 나간 요청이
  // 전환 이후에 뒤늦게 응답할 수 있다. ref는 항상 "지금" 프로젝트를 가리키므로, 응답 시점에
  // 요청 당시와 비교해 어긋나면(=전환됨) 그 응답은 버린다.
  const currentProjectIdRef = useRef(currentProjectId);
  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  const handleToggleNotifications = async () => {
    const opening = !notifOpen;
    setNotifOpen(opening);
    if (!opening || !currentProjectId || currentProjectId < 0) return;

    const requestedProjectId = currentProjectId;
    // 목록을 먼저 불러와 화면에 반영한 뒤, 그 목록에 실제로 있던 id들만 읽음 처리한다.
    // "전체 읽음"을 따로 호출하면 목록을 불러오는 사이에 새로 도착한 알림까지 휩쓸려,
    // 사용자가 보지도 못한 알림이 안 읽음 배지에서 사라질 수 있다 — 방금 화면에 보여준
    // id만 넘기면 그 뒤에 도착하는 알림은 이 요청과 무관하므로 안전하다.
    let list: NotificationResponse[];
    try {
      list = await fetchNotifications(requestedProjectId);
    } catch (err) {
      console.error("알림 목록을 불러오지 못했습니다.", err);
      setNotifError(true);
      return;
    }
    if (currentProjectIdRef.current !== requestedProjectId) return; // 응답 도착 전에 전환됨 - 폐기
    setNotifications(list);
    setNotifError(false);

    const unreadIds = list.filter((n) => !n.read).map((n) => n.id);
    try {
      await markNotificationsRead(unreadIds);
      await refreshUnreadCount();
    } catch (err) {
      console.error("알림 읽음 처리에 실패했습니다.", err);
      // 실패 시 배지 숫자는 그대로 둔다 — 안 읽음 처리에 실패했는데 0으로 낮추면 실제로
      // 안 읽은 알림이 있는데도 없는 것처럼 보인다.
    }
  };

  const segments = location.pathname.split("/").filter(Boolean);
  const activeTab = (segments[0] ?? "dashboard") as Tab;
  const detailPage = segments[1] ?? null;
  const detailTitle = detailPage
    ? (activeTab === "leader" ? LEADER_DETAIL_TITLES[detailPage] : DETAIL_TITLES[detailPage])
    : null;
  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header
      data-global-header
      className="relative z-40 h-14 bg-card border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm min-w-0">
        {isMobile && (
          <button
            onClick={onOpenMobileMenu}
            aria-label="메뉴 열기"
            className="mr-1 p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
          >
            <Menu className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
        <span className="text-muted-foreground">TeamFlow AI</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-muted-foreground truncate max-w-[220px]">{currentProjectName || "프로젝트를 선택하세요"}</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: ROLE_COLORS[role] }}>
          {role}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        {detailPage ? (
          <>
            <button onClick={() => navigate(`/${activeTab}`)} className="text-muted-foreground hover:text-foreground transition-colors">{TAB_TITLES[activeTab]}</button>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{detailTitle ?? detailPage}</span>
          </>
        ) : (
          <span className="font-semibold text-foreground">{TAB_TITLES[activeTab]}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <button onClick={() => setSearchOpen(v => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-sm ${searchOpen ? "bg-secondary border-blue-300" : "border-border bg-muted hover:bg-secondary"}`}>
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          {!searchOpen && <span className="text-muted-foreground text-xs">검색...</span>}
          {searchOpen && <input autoFocus className="bg-transparent outline-none text-xs text-foreground w-32 placeholder-muted-foreground" placeholder="업무, 회의록, 파일 검색" />}
        </button>

        {/* Deadline badge — 실제 프로젝트 마감일 기준 */}
        {dDay && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-600">{dDay} 최종 마감</span>
          </div>
        )}

        <div className="relative">
          <button
            onClick={handleToggleNotifications}
            className={`relative h-10 min-w-10 px-2.5 rounded-xl border shadow-sm transition-all flex items-center justify-center ${
              notifOpen
                ? "border-blue-400 bg-blue-100 text-blue-700"
                : "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-300"
            }`}
            aria-label="알림"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-card">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div
                data-notification-popover
                className="absolute right-0 top-full z-50 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
              >
                <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-foreground">알림</div>
                <div data-notification-list className="min-h-0 max-h-[calc(100vh-10rem)] overflow-y-auto overscroll-contain">
                  {notifError ? (
                    <div className="px-4 py-6 text-xs text-red-600 text-center">알림을 불러오지 못했습니다. 다시 시도해주세요.</div>
                  ) : notifications.length === 0 ? (
                    <div className="px-4 py-6 text-xs text-muted-foreground text-center">알림이 없습니다.</div>
                  ) : notifications.map(n => {
                    const isActionRequired = ACTION_REQUIRED_NOTIFICATION_TYPES.has(n.type);
                    return (
                      <div
                        key={n.id}
                        className={`px-4 py-2.5 border-b border-border last:border-0 text-xs text-foreground ${isActionRequired ? "bg-amber-50" : ""}`}
                      >
                        <div className="flex items-center gap-1.5">
                          {isActionRequired && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold">할 일</span>
                          )}
                          <div className="font-semibold">{n.title}</div>
                        </div>
                        {n.content && <div className="text-muted-foreground mt-0.5">{n.content}</div>}
                        <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(n.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" })}</div>
                        {MEETING_SHORTCUT_NOTIFICATION_TYPES.has(n.type) && n.targetType === "meeting" && n.targetId && (
                          <button
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(`/meetings?meetingId=${n.targetId}${meetingNotificationPanelQuery(n.type)}`);
                            }}
                            className="mt-1.5 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
                          >
                            바로가기
                          </button>
                        )}
                        {n.targetType === "task" && n.targetId && (
                          <button
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(`/board?taskId=${encodeURIComponent(n.targetId)}`);
                            }}
                            className="mt-1.5 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
                          >
                            바로가기
                          </button>
                        )}
                        {n.targetType === "evaluation" && n.targetId && (
                          <button
                            onClick={() => {
                              setNotifOpen(false);
                              navigate("/mypage");
                            }}
                            className="mt-1.5 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
                          >
                            바로가기
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 현재 프로젝트 접속 중인 사용자 아바타 (5초 간격 폴링) */}
        {presenceUsers.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1">
            <div className="flex -space-x-2">
              {presenceUsers.slice(0, 6).map(presenceUser => (
                presenceUser.avatarUrl ? (
                  <img
                    key={presenceUser.userId}
                    src={presenceUser.avatarUrl}
                    alt={presenceUser.name}
                    title={`${presenceUser.name} / ${presenceUser.role}`}
                    className="w-8 h-8 rounded-full border-2 border-card object-cover"
                  />
                ) : (
                  <div
                    key={presenceUser.userId}
                    title={`${presenceUser.name} / ${presenceUser.role}`}
                    className="w-8 h-8 rounded-full border-2 border-card flex items-center justify-center text-white text-xs font-semibold"
                    style={{ background: "#3B5BDB" }}
                  >
                    {presenceUser.name.slice(0, 1)}
                  </div>
                )
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden sm:inline">
              현재 {presenceUsers.length}명 접속 중
            </span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-card text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </header>
  );
}
