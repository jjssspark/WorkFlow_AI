import { NavLink, Outlet } from "react-router";

const TABS = [
  { path: "roadmap", label: "로드맵" },
  { path: "completion-approvals", label: "완료승인 대기" },
];

export function LeaderPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border shrink-0 bg-card px-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `px-4 text-sm font-semibold py-3 border-b-2 transition-colors ${
                isActive ? "border-blue-500 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
