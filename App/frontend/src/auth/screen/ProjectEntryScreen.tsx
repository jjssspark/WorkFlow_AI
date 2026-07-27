import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Crown,
  GraduationCap,
  KeyRound,
  Link2,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AuthBrandPanel } from "../components/AuthBrandPanel";
import { useAuth } from "../../global/hooks/useAuth";
import type { ProjectRoleKo, ProjectRoleSummary } from "../../global/api/authTypes";
import { joinProjectByCode, listProjects, type ProjectResponse } from "../../global/api/projectsApi";
import { REVIEWER_ACTIVITIES } from "../../global/lib/mock/reviewer";
import { EVAL_STATUS_META, resolveEvalStatus } from "../../global/lib/evalStatus";

const PROJECT_META: Record<number, { type: string; deadline: string; progress: number }> = {};

const ROLE_META: Record<ProjectRoleKo, { label: string; color: string; bg: string; icon: typeof Crown }> = {
  "팀장": { label: "팀장", color: "#3B5BDB", bg: "rgba(59,91,219,0.1)", icon: Crown },
  "팀원": { label: "팀원", color: "#10B981", bg: "rgba(16,185,129,0.1)", icon: UserRound },
  "심사자": { label: "심사자", color: "#7048E8", bg: "rgba(112,72,232,0.1)", icon: KeyRound },
};

// "심사 프로젝트 추가" 입력창으로 임시 등록한 항목 — 배정 코드로 심사자를 실제 프로젝트에
// 연결하는 백엔드 API가 아직 없어, 실제 배정된 프로젝트 목록과 분리해 로컬에서만 표시한다.
interface LocalJudgeProject {
  id: string;
  name: string;
}

export function ProjectEntryScreen() {
  const navigate = useNavigate();
  const { user, projectRoles, currentProject, selectProject, addLocalProjectRole, refreshMe, logout } = useAuth();
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // 배정 코드로 실제 심사자 권한을 붙이는 백엔드 API가 아직 없어, "심사 프로젝트 추가"로
  // 입력한 항목은 실제 배정 목록과 별도로 로컬에만 보관한다.
  const [localJudgeProjects, setLocalJudgeProjects] = useState<LocalJudgeProject[]>([]);
  const [judgeProjectCode, setJudgeProjectCode] = useState("");
  const [judgeMessage, setJudgeMessage] = useState<string | null>(null);

  const isJudgeHome =
    currentProject?.role === "심사자" ||
    (projectRoles.length > 0 && projectRoles.every((project) => project.role === "심사자"));
  const projects = projectRoles;

  // 심사자에게 실제로 배정된 프로젝트 목록 — GET /api/v1/projects는 REVIEWER 역할로
  // 속한 프로젝트도 그대로 포함해서 내려준다(로그인 직후에도 새로고침 없이 뜨도록).
  const [assignedProjects, setAssignedProjects] = useState<ProjectResponse[]>([]);
  const [assignedProjectsError, setAssignedProjectsError] = useState<string | null>(null);
  useEffect(() => {
    if (!isJudgeHome) return;
    listProjects()
      .then((result) => {
        setAssignedProjects(result);
        setAssignedProjectsError(null);
      })
      .catch(() => setAssignedProjectsError("배정된 프로젝트를 불러오지 못했습니다."));
  }, [isJudgeHome]);

  const handleBackToLogin = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const enterProject = (project: ProjectRoleSummary) => {
    if (project.projectId < 0 && !projectRoles.some((role) => role.projectId === project.projectId)) {
      const projectId = addLocalProjectRole(project.projectTitle || "초대받은 팀 프로젝트", project.role);
      selectProject(projectId);
    } else {
      selectProject(project.projectId);
    }
    navigate("/dashboard");
  };

  const handleJoinByCode = async () => {
    const rawCode = inviteCode.trim();
    if (!rawCode) {
      setMessage("초대 URL 또는 코드를 입력해주세요.");
      return;
    }
    // 초대 URL로 붙여넣었을 수 있으니 마지막 경로 조각만 코드로 사용한다.
    const code = rawCode.split("/").filter(Boolean).pop() ?? rawCode;
    setJoining(true);
    setMessage(null);
    try {
      const project = await joinProjectByCode(code);
      await refreshMe();
      selectProject(project.id);
      navigate("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "참여에 실패했습니다.");
    } finally {
      setJoining(false);
    }
  };

  // 실제로 배정된 프로젝트 진입 — currentProjectId를 진짜 projectId로 설정하므로
  // ContributorsView가 처음부터 실제 데이터를 불러온다(새로고침 불필요).
  const enterAssignedProject = (project: ProjectResponse) => {
    selectProject(project.id);
    navigate("/contributors");
  };

  // "심사 프로젝트 추가"로 입력한 항목 — 배정 코드로 심사자를 실제 프로젝트에 연결하는
  // 백엔드 API가 아직 없어, 로컬 표시용 가짜 프로젝트로만 등록한다(기여도 데이터는 비어 보임).
  const enterLocalJudgeProject = (project: LocalJudgeProject) => {
    const projectId = addLocalProjectRole(project.name, "심사자");
    selectProject(projectId);
    navigate("/contributors");
  };

  const handleAddJudgeProject = () => {
    const value = judgeProjectCode.trim();
    if (!value) {
      setJudgeMessage("프로젝트 URL, 코드 또는 프로젝트명을 입력해주세요.");
      return;
    }

    const newProject: LocalJudgeProject = {
      id: `J-${Date.now()}`,
      name: value.includes("http") || value.length <= 12 ? "신규 심사 배정 프로젝트" : value,
    };
    setLocalJudgeProjects((prev) => [newProject, ...prev]);
    setJudgeMessage("심사 프로젝트가 추가되었습니다. 목록에서 선택하면 기여도 분석으로 이동합니다.");
    setJudgeProjectCode("");
  };

  if (isJudgeHome) {
    const evaluatingCount = assignedProjects.filter(
      (project) => resolveEvalStatus(project.evalStatus) === "EVALUATING",
    ).length;
    const publishedCount = assignedProjects.filter(
      (project) => resolveEvalStatus(project.evalStatus) === "PUBLISHED",
    ).length;

    return (
      <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
        <AuthBrandPanel />

        <div className="flex-1 bg-background px-4 py-6 sm:px-6 lg:px-8 lg:py-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto space-y-6">
            <BackToLoginButton onClick={handleBackToLogin} />
            <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-100 px-2.5 py-1 rounded-lg mb-3">
                  <GraduationCap className="w-3.5 h-3.5" />
                  심사자 홈
                </div>
                <h1 className="text-2xl font-bold text-foreground mb-1">
                  {user?.name || "박교수"}님, 심사할 프로젝트를 선택하세요
                </h1>
                <p className="text-sm text-muted-foreground">
                  배정된 프로젝트를 누르면 해당 팀의 기여도 분석 상세 화면으로 이동합니다.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:w-[430px]">
                {[
                  { label: "배정", value: assignedProjects.length, color: "#7048E8" },
                  { label: "평가 중", value: evaluatingCount, color: "#D97706" },
                  { label: "공개 완료", value: publishedCount, color: "#059669" },
                ].map((item) => (
                  <div key={item.label} className="bg-card border border-border rounded-xl px-3 py-2.5 shadow-sm">
                    <div className="text-[11px] text-muted-foreground">{item.label}</div>
                    <div className="text-xl font-bold mt-0.5" style={{ color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <section className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <div className="text-sm font-bold text-foreground">배정된 프로젝트</div>
                  <div className="text-xs text-muted-foreground mt-1">담당 팀을 선택해 기여도를 검토합니다.</div>
                </div>

                {assignedProjectsError && (
                  <p className="px-5 py-3 text-xs font-semibold text-red-600">{assignedProjectsError}</p>
                )}

                {assignedProjects.length === 0 && localJudgeProjects.length === 0 && !assignedProjectsError && (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    아직 배정된 프로젝트가 없습니다.
                  </div>
                )}

                <div className="divide-y divide-border">
                  {assignedProjects.map((project) => {
                    const meta = EVAL_STATUS_META[resolveEvalStatus(project.evalStatus)];
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => enterAssignedProject(project)}
                        className="w-full text-left px-5 py-5 hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h2 className="text-lg font-bold text-foreground leading-snug">{project.title}</h2>
                              <span
                                className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold"
                                style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">{project.memberCount}명</div>
                          </div>
                          <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0 hidden sm:block" />
                        </div>

                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-muted-foreground">프로젝트 진행률</span>
                            <span className="font-bold text-foreground">{project.taskProgress}%</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${project.taskProgress}%` }} />
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {localJudgeProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => enterLocalJudgeProject(project)}
                      className="w-full text-left px-5 py-5 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-bold text-foreground leading-snug">{project.name}</h2>
                        <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0 hidden sm:block" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <aside className="space-y-4">
                <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-foreground">심사 프로젝트 추가</h2>
                      <p className="text-xs text-muted-foreground">배정 코드, URL, 프로젝트명으로 추가합니다.</p>
                    </div>
                  </div>
                  <input
                    value={judgeProjectCode}
                    onChange={(event) => { setJudgeProjectCode(event.target.value); setJudgeMessage(null); }}
                    placeholder="예: review-T5 또는 프로젝트 초대 URL"
                    className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  />
                  {judgeMessage && <div className="mt-2 text-xs text-violet-600 leading-relaxed">{judgeMessage}</div>}
                  <button
                    type="button"
                    onClick={handleAddJudgeProject}
                    className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    프로젝트 추가
                  </button>
                </section>

                <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardCheck className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-bold text-foreground">최근 심사 활동</h2>
                  </div>
                  <div className="space-y-3">
                    {REVIEWER_ACTIVITIES.map((activity, index) => (
                      <div key={`${activity.team}-${index}`} className="border-b border-border last:border-0 pb-3 last:pb-0">
                        <div className="text-xs font-semibold text-foreground">{activity.action}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{activity.team} · {activity.date}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <AuthBrandPanel />

      <div className="flex-1 bg-background px-4 py-6 sm:px-6 lg:px-8 lg:py-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <BackToLoginButton onClick={handleBackToLogin} />
          <div className="mb-7">
            <div className="text-xs font-semibold text-blue-600 mb-2">프로젝트 진입</div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              {user?.name || "사용자"}님, 참여할 프로젝트를 선택하세요
            </h1>
            <p className="text-sm text-muted-foreground">
              프로젝트를 직접 만들면 팀장으로, 초대 코드로 참여하면 팀원으로 연결됩니다.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground">내 프로젝트 목록</h2>
                <span className="text-xs text-muted-foreground">권한이 함께 표시됩니다.</span>
              </div>

              {projects.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-foreground">아직 참여 중인 프로젝트가 없습니다</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    오른쪽에서 새 프로젝트를 만들거나 초대 코드로 참여해보세요.
                  </p>
                </div>
              )}

              {projects.map((project) => {
                const role = ROLE_META[project.role];
                const RoleIcon = role.icon;
                const meta = PROJECT_META[project.projectId] ?? { type: "캡스톤디자인", deadline: "진행 중", progress: 0 };
                return (
                  <button
                    key={project.projectId}
                    onClick={() => enterProject(project)}
                    className="w-full text-left bg-card border border-border rounded-xl p-4 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-bold text-foreground truncate">{project.projectTitle || "제목 없음"}</h3>
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold shrink-0"
                            style={{ color: role.color, background: role.bg }}
                          >
                            <RoleIcon className="w-3 h-3" />
                            {role.label}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">{meta.type} · {meta.deadline}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span>진행률</span>
                        <span>{meta.progress}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${meta.progress}%`, background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </section>

            <section className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "#3B5BDB" }}>
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">새 프로젝트 생성</h2>
                    <p className="text-xs text-muted-foreground">생성 즉시 팀장 권한으로 시작합니다.</p>
                  </div>
                </div>
                <button
                  onClick={() => navigate("/onboarding")}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
                >
                  <Crown className="w-4 h-4" />
                  프로젝트 정보 입력하고 시작하기
                </button>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "#10B981" }}>
                    <Link2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">초대 URL 또는 코드 입력</h2>
                    <p className="text-xs text-muted-foreground">참여하면 팀원 권한으로 연결됩니다.</p>
                  </div>
                </div>
                <input
                  value={inviteCode}
                  onChange={(event) => { setInviteCode(event.target.value); setMessage(null); }}
                  className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="예: https://teamflow.ai/invite/gX4mKp 또는 gX4mKp"
                />
                {message && <div className="mt-2 text-xs text-red-500">{message}</div>}
                <button
                  onClick={() => void handleJoinByCode()}
                  disabled={joining}
                  className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: "#10B981" }}
                >
                  <UserRound className="w-4 h-4" />
                  {joining ? "참여 중..." : "팀원으로 참여"}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackToLoginButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      로그인 화면으로 돌아가기
    </button>
  );
}
