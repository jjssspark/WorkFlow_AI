import { useNavigate } from "react-router";
import { useAuth } from "../../global/hooks/useAuth";
import { useEffect, useState } from "react";
import {
  User, Shield, Settings, Bell, LogOut, Github, ChevronRight,
  FileText, CheckCircle2, Clock, AlertTriangle, Star, Download,
  MessageSquare, GitCommit, GitPullRequest, GitMerge, FileAudio,
  Package, Sparkles, Check, X, Eye, EyeOff, Edit, BarChart3,
  Calendar, Layers, ArrowRight, AlertCircle, Users, RefreshCw,
  Link2, Target, Award
} from "lucide-react";
import { StatusBadge } from "../../global/component/StatusBadge";
import { DelivBadge } from "../../deliverables/components/DelivBadge";
import { SectionTitle } from "../../global/component/SectionTitle";
import { ProjectSettingsSection } from "./ProjectSettingsSection";
import {
  MEMBER_USER, MY_FEEDBACKS,
} from "../libs/mock/mypage";
import { CONTRIB_REPORTS } from "../../global/lib/mock/reviewer";
import { useMyTasks } from "../libs/hooks/useMyTasks";
import { useReviewerProjects } from "../libs/hooks/useReviewerProjects";
import { useReviewerContribution } from "../libs/hooks/useReviewerContribution";
import { resolveMemberDisplay } from "../../dashboard/libs/utils/memberDisplay";
import { getDueToday, getDueThisWeek } from "../libs/utils/taskWidgets";
import { getDoneCount, getInProgressCount, getBlockedCount, getTasksByStatus, formatDueDate } from "../../board/libs/utils/taskService";
import { getMyEvaluation, type MyEvaluationDto } from "../../global/api/evaluationApi";

// ─── local types ──────────────────────────────────────────────────────────────
export type MyPageRole = "member" | "reviewer";

type EvalStatus = "pending" | "evaluating" | "done" | "published";
const EVAL_STATUS_META: Record<EvalStatus, { label: string; cls: string }> = {
  pending: { label: "평가 전", cls: "bg-slate-100 text-slate-500" },
  evaluating: { label: "평가 중", cls: "bg-amber-100 text-amber-600" },
  done: { label: "평가 완료", cls: "bg-blue-100 text-blue-600" },
  published: { label: "공개 완료", cls: "bg-emerald-100 text-emerald-600" },
};

// ─── Member My Page ───────────────────────────────────────────────────────────
function MemberMyPage({ name, email, onLogout, projectId, userId }: { name: string; email: string; onLogout: () => void; projectId: number | null; userId: number | null }) {
  const [taskView, setTaskView] = useState<"all"|"today"|"week">("all");
  const [showScore, setShowScore] = useState(false);
  const initials = name ? name[0] : MEMBER_USER.initials;

  // 심사자가 기여도 분석 화면에서 "공개"로 확정한 평가 결과. 비공개 상태면 revealed=false.
  const [myEvaluation, setMyEvaluation] = useState<MyEvaluationDto | null>(null);
  useEffect(() => {
    if (projectId == null) {
      setMyEvaluation(null);
      return;
    }
    getMyEvaluation(projectId).then(setMyEvaluation).catch(() => setMyEvaluation(null));
  }, [projectId]);

  const { tasks: myTasks, loadState, reload } = useMyTasks(projectId, userId);
  const dueToday = getDueToday(myTasks);
  const dueThisWeek = getDueThisWeek(myTasks);
  const visibleTasks = taskView === "today" ? dueToday : taskView === "week" ? dueThisWeek : myTasks;
  const todayNotDone = dueToday.filter(t => t.status !== "done");
  const thisWeekNotDone = dueThisWeek.filter(t => t.status !== "done");

  const taskCounts = {
    done: getDoneCount(myTasks),
    inprogress: getInProgressCount(myTasks),
    blocked: getBlockedCount(myTasks),
    todo: getTasksByStatus("todo", myTasks).length,
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>

      {/* ── Profile card ── */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-16" style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }} />
        <div className="px-6 pb-5">
          <div className="flex items-end justify-between -mt-8 mb-4">
            <div className="w-16 h-16 rounded-2xl border-4 border-white flex items-center justify-center text-white font-bold text-xl" style={{ background: MEMBER_USER.color }}>
              {initials}
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><Settings className="w-3.5 h-3.5" />설정</button>
              <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"><LogOut className="w-3.5 h-3.5" />로그아웃</button>
            </div>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold text-foreground">{name}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">팀원</span>
              </div>
              <div className="text-xs text-muted-foreground">{email}</div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{MEMBER_USER.affiliation}</span>
                <span className="text-border">·</span>
                <span className="font-medium text-blue-600">{MEMBER_USER.field}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">참여 프로젝트</div>
              <div className="text-sm font-semibold text-foreground">{MEMBER_USER.project}</div>
              <div className="flex items-center gap-1.5 mt-1.5 justify-end">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-emerald-600 font-medium">GitHub 연결됨</span>
                <span className="text-[10px] text-muted-foreground">({MEMBER_USER.github})</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── AI Recommendation ── */}
      <div className="rounded-xl p-4 flex items-start gap-3 border border-purple-200" style={{ background:"rgba(112,72,232,0.05)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-foreground mb-0.5">오늘 집중할 업무 AI 추천</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">TF-07 관리자 대시보드 통계 모듈</strong>을 오늘 완료하면 이번 주 마감 업무를 모두 처리할 수 있습니다. PR 제출 전 팀장에게 리뷰를 요청하세요.
          </div>
        </div>
        <button className="text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80" style={{ background:"rgba(112,72,232,0.15)", color:"#7048E8" }}>
          자세히
        </button>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-3 gap-4">
        {loadState === "loading" && (
          <div className="col-span-3 h-40 flex items-center justify-center text-sm text-muted-foreground">업무 정보를 불러오는 중...</div>
        )}
        {loadState === "error" && (
          <div className="col-span-3 h-40 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <span>업무 정보를 불러오지 못했습니다.</span>
            <button
              onClick={reload}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
              style={{ background: "var(--primary)" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />다시 시도
            </button>
          </div>
        )}
        {loadState === "ready" && (
          <>
            {/* Left: task status (2/3) */}
            <div className="col-span-2 space-y-4">
              {/* Stat cards */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label:"완료", value: taskCounts.done,      color:"#10B981", Icon: CheckCircle2 },
                  { label:"진행 중", value: taskCounts.inprogress, color:"#3B5BDB", Icon: Clock },
                  { label:"블로커", value: taskCounts.blocked,    color:"#EF4444", Icon: AlertTriangle },
                  { label:"대기",   value: taskCounts.todo,       color:"#8892A4", Icon: Layers },
                ].map(s => (
                  <div key={s.label} className="bg-card rounded-xl p-4 border border-border shadow-sm text-center">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2" style={{ background:`${s.color}15` }}>
                      <s.Icon className="w-4 h-4" style={{ color: s.color }} />
                    </div>
                    <div className="text-xl font-bold text-foreground">{s.value}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Task list */}
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                  <SectionTitle>내 업무 목록</SectionTitle>
                  <div className="flex gap-1">
                    {(["all","today","week"] as const).map(v => (
                      <button key={v} onClick={() => setTaskView(v)} className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all ${taskView===v?"bg-blue-600 text-white":"border border-border text-muted-foreground hover:border-slate-300"}`}>
                        {v==="all"?"전체":v==="today"?"오늘":"이번 주"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {visibleTasks.length === 0 && (
                    <div className="px-5 py-6 text-center text-xs text-muted-foreground">담당 중인 업무가 없습니다.</div>
                  )}
                  {visibleTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                      <span className="font-mono text-[10px] text-muted-foreground w-12">{task.id}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">{task.title}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{task.category} · 마감 {formatDueDate(task.dueDate)}</div>
                      </div>
                      <StatusBadge status={task.status} />
                      <button className="text-[10px] font-medium text-blue-600 hover:text-blue-700 shrink-0">상태 변경</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: today + deadlines (1/3) */}
            <div className="space-y-4">
              <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                <SectionTitle>오늘 할 일</SectionTitle>
                <div className="space-y-2">
                  {todayNotDone.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-3">오늘 마감인 업무가 없습니다.</div>
                  ) : (
                    todayNotDone.map(task => (
                      <div key={task.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                        <div className="w-4 h-4 rounded border border-border flex items-center justify-center shrink-0">
                          {task.status==="done" && <Check className="w-2.5 h-2.5 text-emerald-500" />}
                        </div>
                        <span className="text-xs text-foreground flex-1 truncate">{task.title}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                <SectionTitle>이번 주 마감</SectionTitle>
                <div className="space-y-2.5">
                  {thisWeekNotDone.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-3">이번 주 마감인 업무가 없습니다.</div>
                  ) : (
                    thisWeekNotDone.map(task => {
                      const isDueToday = todayNotDone.some(t => t.id === task.id);
                      return (
                        <div key={task.id} className="flex items-center justify-between text-xs">
                          <span className="text-foreground truncate flex-1">{task.title}</span>
                          <span className={`font-bold ml-2 shrink-0 ${isDueToday?"text-amber-600":"text-muted-foreground"}`}>{formatDueDate(task.dueDate)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <ProjectSettingsSection />

              {/* Public score (if revealed) — 기여 점수/총합·심사자점수·학점은 심사자가 서로 다른
                  시점에 독립적으로 공개할 수 있다(중간 점검 vs 최종 확정). 기여 점수만 공개됐으면
                  기여 점수 칸만 보이고 총합/학점 칸은 아직 뜨지 않는다. */}
              {(myEvaluation?.contributionRevealed || myEvaluation?.finalRevealed) && (
                <div className="bg-card rounded-xl border border-emerald-300 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-bold text-foreground">공개된 평가 결과</span>
                  </div>
                  {showScore ? (
                    <div>
                      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                        <div>
                          <div className="text-2xl font-bold text-foreground">
                            {myEvaluation?.contributionRevealed && myEvaluation.score != null
                              ? myEvaluation.score.toFixed(2)
                              : "-"}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">기여 점수</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-foreground">
                            {myEvaluation?.finalRevealed && myEvaluation.reviewerScore != null
                              ? myEvaluation.reviewerScore.toFixed(2)
                              : "-"}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">심사자 점수</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-emerald-600">
                            {myEvaluation?.finalRevealed ? myEvaluation.grade ?? "-" : "-"}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">학점</div>
                        </div>
                      </div>
                      <button onClick={() => setShowScore(false)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground w-full text-center">숨기기</button>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <div className="text-xs text-muted-foreground mb-2">심사자가 평가를 공개했습니다.</div>
                      <button onClick={() => setShowScore(true)} className="flex items-center gap-1.5 mx-auto text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                        <Eye className="w-3.5 h-3.5" />결과 확인하기
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 개인 코멘트/피드백 — 공개된 평가 결과 바로 아래, 세로로 긴 목록 형태로 배치.
                  심사자가 공개한 심사 코멘트는 목록 맨 앞에 별도 항목으로 추가된다. */}
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border"><SectionTitle>개인 코멘트 / 피드백</SectionTitle></div>
                <div className="p-4 space-y-3">
                  {myEvaluation?.commentRevealed && myEvaluation.comment && (
                    <div className="rounded-xl p-3.5 border border-emerald-200 bg-emerald-50/40">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold bg-emerald-600">심</div>
                        <span className="text-[11px] font-semibold text-foreground">심사자 코멘트</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{myEvaluation.comment}</p>
                    </div>
                  )}
                  {MY_FEEDBACKS.map((f, i) => (
                    <div key={i} className={`rounded-xl p-3.5 border ${f.type==="ai"?"border-purple-200 bg-purple-50/40":"border-border bg-muted/30"}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: f.type==="ai"?"#7048E8":"#3B5BDB" }}>
                          {f.type==="ai"?"AI":f.from[0]}
                        </div>
                        <span className="text-[11px] font-semibold text-foreground">{f.from}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{f.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{f.content}</p>
                    </div>
                  ))}
                  <button className="w-full py-2 text-xs font-medium text-blue-600 border border-dashed border-blue-300 rounded-xl hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />답글 작성
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

// ─── Reviewer My Page ─────────────────────────────────────────────────────────
type ReviewerPanelTab = "summary" | "deliverables" | "contrib" | "ai-evidence" | "score";

const REVIEWER_AVATAR_COLOR = "#3B5BDB";

function ReviewerMyPage({ name, email, onLogout }: { name: string; email: string; onLogout: () => void }) {
  const initials = name ? name[0] : "심";
  const { projects, loadState, reload } = useReviewerProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<ReviewerPanelTab>("summary");
  const [scores, setScores] = useState<Record<string,string>>({ "1":"92","2":"88","3":"85","4":"72" });
  const [publicFlags, setPublicFlags] = useState<Record<string,boolean>>({ "1":true,"2":false,"3":false,"4":false });

  useEffect(() => {
    if (selectedProjectId === null && projects.length > 0) {
      setSelectedProjectId(projects[0].projectId);
    }
  }, [projects, selectedProjectId]);

  const team = projects.find(p => p.projectId === selectedProjectId) ?? null;
  const contribProjectId = panelTab === "contrib" || panelTab === "ai-evidence" ? (team?.projectId ?? null) : null;
  const { rows: contribRows, loadState: contribLoadState, reload: reloadContrib } = useReviewerContribution(contribProjectId);
  const evalCounts = {
    pending: projects.filter(p => p.evalStatus === "pending").length,
    evaluating: projects.filter(p => p.evalStatus === "evaluating").length,
    done: projects.filter(p => p.evalStatus === "done").length,
    published: projects.filter(p => p.evalStatus === "published").length,
  };

  const PANEL_TABS: { id: ReviewerPanelTab; label: string }[] = [
    { id:"summary",       label:"팀 요약" },
    { id:"deliverables",  label:"산출물" },
    { id:"contrib",       label:"기여도 리포트" },
    { id:"ai-evidence",   label:"AI 평가 근거" },
    { id:"score",         label:"점수 입력" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>

      {/* ── Reviewer Profile ── */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shrink-0" style={{ background: REVIEWER_AVATAR_COLOR }}>
            {initials}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-lg font-bold text-foreground">{name}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">심사자</span>
            </div>
            <div className="text-xs text-muted-foreground">{email}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><Settings className="w-3.5 h-3.5" />설정</button>
            <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg"><LogOut className="w-3.5 h-3.5" />로그아웃</button>
          </div>
        </div>

        {/* Eval status summary */}
        <div className="flex items-center gap-3 mt-4">
          {[
            { label:"평가 전",   count: evalCounts.pending,    color:"#8892A4" },
            { label:"평가 중",   count: evalCounts.evaluating, color:"#F59E0B" },
            { label:"평가 완료", count: evalCounts.done,       color:"#3B5BDB" },
            { label:"공개 완료", count: evalCounts.published,  color:"#10B981" },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span className="text-sm font-bold text-foreground">{s.count}</span>
            </div>
          ))}
          <div className="ml-auto text-xs text-muted-foreground">총 {projects.length}개 팀 담당</div>
        </div>
      </div>

      {/* ── Main: project list + detail panel ── */}
      <div className="flex-1 overflow-hidden flex gap-0 min-h-0">

        {/* Left: project list */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">배정된 프로젝트</div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {loadState === "loading" && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
            )}
            {loadState === "error" && (
              <div className="px-4 py-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                <span>프로젝트 목록을 불러오지 못했습니다.</span>
                <button onClick={reload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90 transition-opacity" style={{ background: "var(--primary)" }}>
                  <RefreshCw className="w-3.5 h-3.5" />다시 시도
                </button>
              </div>
            )}
            {loadState === "ready" && projects.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">배정된 프로젝트가 없습니다.</div>
            )}
            {loadState === "ready" && projects.map(p => {
              const sm = EVAL_STATUS_META[p.evalStatus];
              const isSelected = selectedProjectId === p.projectId;
              return (
                <button key={p.projectId} onClick={() => { setSelectedProjectId(p.projectId); setPanelTab("summary"); }}
                  className={`w-full text-left px-4 py-3.5 transition-all hover:bg-muted/40 ${isSelected?"bg-blue-50 border-r-2 border-r-blue-500":""}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-xs font-bold text-foreground leading-snug flex-1">{p.title}</div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${sm.cls}`}>{sm.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{p.leaderName ?? "팀장 미배정"} 팀장</span>
                    <span>{p.memberCount}명</span>
                  </div>
                  <div className="mt-2 w-full h-1.5 bg-muted rounded-full">
                    <div className="h-1.5 rounded-full" style={{ width:`${p.progressPercent}%`, background: p.evalStatus==="published"?"#10B981":"#3B5BDB" }} />
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-muted-foreground">진행률</span>
                    <span className="text-[10px] font-semibold text-foreground">{p.progressPercent}%</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Recent eval activity */}
          <div className="border-t border-border p-4">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">최근 평가 활동</div>
            <div className="text-[10px] text-muted-foreground py-1">아직 평가 활동이 없습니다.</div>
          </div>
        </div>

        {/* Right: team detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {team === null ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              {loadState === "ready" && projects.length > 0 ? "왼쪽에서 프로젝트를 선택하세요." : ""}
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="shrink-0 px-5 py-3 border-b border-border bg-card">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-bold text-foreground">{team.title}</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${EVAL_STATUS_META[team.evalStatus].cls}`}>{EVAL_STATUS_META[team.evalStatus].label}</span>
                    <button className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"><Shield className="w-3 h-3" />대시보드 열람</button>
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg hover:bg-muted transition-colors"><FileText className="w-3 h-3" />PDF 다운로드</button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{team.leaderName ?? "팀장 미배정"} 팀장 · {team.memberCount}명 · GitHub {team.githubConnected?"연결됨":"미연결"} · 산출물 {team.deliverablesSubmitted}/{team.deliverablesTotal}개 제출</div>
              </div>

              {/* Panel tabs */}
              <div className="flex border-b border-border shrink-0 bg-card">
                {PANEL_TABS.map(tab => (
                  <button key={tab.id} onClick={() => setPanelTab(tab.id)}
                    className={`flex-1 text-[11px] font-semibold py-2.5 border-b-2 transition-colors ${panelTab===tab.id?"border-blue-500 text-blue-600":"border-transparent text-muted-foreground hover:text-foreground"}`}>
                    {tab.id==="contrib"||tab.id==="ai-evidence"||tab.id==="score" ? <span className="flex items-center justify-center gap-1"><Shield className="w-2.5 h-2.5 text-blue-400" />{tab.label}</span> : tab.label}
                  </button>
                ))}
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-y-auto p-5">

                {/* Summary tab */}
                {panelTab === "summary" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { l:"전체 업무", v:"14개", color:"#3B5BDB" },
                        { l:"완료율",   v:`${team.progressPercent}%`, color:"#10B981" },
                        { l:"블로커",   v:"2개", color:"#EF4444" },
                        { l:"마감",     v:"D-18", color:"#F59E0B" },
                      ].map(s => (
                        <div key={s.l} className="bg-card rounded-xl p-3.5 border border-border text-center shadow-sm">
                          <div className="text-lg font-bold" style={{ color: s.color }}>{s.v}</div>
                          <div className="text-[10px] text-muted-foreground">{s.l}</div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">팀 코멘트 작성</div>
                      <textarea rows={3} placeholder="이 팀 전체에 대한 코멘트를 작성하세요 (팀원 전체에 공개 가능)..." className="w-full text-xs rounded-xl border border-border bg-input-background px-4 py-3 outline-none focus:border-blue-400 resize-none" />
                      <div className="flex gap-2 mt-2">
                        <button className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90" style={{ background:"var(--primary)" }}>등록</button>
                        <button className="px-4 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted text-muted-foreground">비공개로 등록</button>
                      </div>
                    </div>
                    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">심사자 내부 메모</div>
                      <textarea rows={2} placeholder="심사자 내부 메모 (팀원에게 노출되지 않음)..." className="w-full text-xs rounded-xl border border-border bg-input-background px-4 py-2.5 outline-none focus:border-blue-400 resize-none" />
                    </div>
                  </div>
                )}

                {/* Deliverables tab */}
                {panelTab === "deliverables" && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground mb-2">제출된 산출물 {team.deliverablesSubmitted}개 / 전체 {team.deliverablesTotal}개</div>
                    {["최종 발표 PPT 초안","중간 진행 보고서","GitHub README 초안"].map((d, i) => (
                      <div key={i} className="flex items-center gap-3 p-3.5 bg-card rounded-xl border border-border shadow-sm">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center"><Package className="w-4 h-4 text-blue-600" /></div>
                        <div className="flex-1"><div className="text-xs font-semibold text-foreground">{d}</div><div className="text-[10px] text-muted-foreground">12.10 업데이트</div></div>
                        <DelivBadge status={i===0?"draft":"done"} />
                        <button className="p-1.5 hover:bg-muted rounded-lg transition-colors"><FileText className="w-3.5 h-3.5 text-muted-foreground" /></button>
                      </div>
                    ))}
                  </div>
                )}

            {/* Contribution report tab — REVIEWER ONLY */}
            {panelTab === "contrib" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 mb-3">
                  <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 font-medium">심사자 전용 기능입니다. 팀원에게 노출되지 않습니다.</span>
                </div>
                {contribLoadState === "loading" && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
                )}
                {contribLoadState === "error" && (
                  <div className="px-4 py-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                    <span>기여도 리포트를 불러오지 못했습니다.</span>
                    <button onClick={reloadContrib} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90 transition-opacity" style={{ background: "var(--primary)" }}>
                      <RefreshCw className="w-3.5 h-3.5" />다시 시도
                    </button>
                  </div>
                )}
                {contribLoadState === "ready" && contribRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">팀원이 없습니다.</div>
                )}
                {contribLoadState === "ready" && contribRows.map((r, i) => {
                  const color = resolveMemberDisplay(r.name, i, String(r.userId)).color;
                  return (
                    <div key={r.userId} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: color }}>{r.name[0]}</div>
                        <div><div className="text-sm font-bold text-foreground">{r.name}</div><div className="text-[10px] text-muted-foreground">{r.role}</div></div>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">To-Do {r.todoDone}/{r.todoTotal} · 회의 {r.meetings}/{r.meetingsTotal}회</span>
                        </div>
                      </div>
                      <div className="px-5 py-3 space-y-2">
                        {r.categories && Object.entries({ "업무 수행":r.categories.task, "회의 참여":r.categories.meeting, "업무 편중도":r.categories.workload }).map(([label, val]) => (
                          <div key={label} className="flex items-center gap-3">
                            <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
                            <div className="flex-1 h-1.5 bg-muted rounded-full"><div className="h-1.5 rounded-full" style={{ width:`${val}%`, background: color }} /></div>
                            <span className="text-[10px] font-semibold text-foreground w-6 text-right">{val}</span>
                          </div>
                        ))}
                        <div className="mt-2 p-2.5 rounded-lg text-xs text-muted-foreground leading-relaxed" style={{ background:"rgba(0,0,0,0.03)" }}>
                          <strong className="text-foreground">AI 요약:</strong> {r.aiSummary ?? "AI 요약이 아직 없습니다."}
                        </div>
                        <div className="text-[10px] text-muted-foreground">근거: {r.evidence.length > 0 ? r.evidence.join(" / ") : "근거 없음"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI Evidence tab — REVIEWER ONLY */}
            {panelTab === "ai-evidence" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 font-medium">AI 평가 근거 — 심사자 전용 · AI는 점수를 확정하지 않고 근거만 제공합니다.</span>
                </div>
                {contribLoadState === "loading" && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
                )}
                {contribLoadState === "error" && (
                  <div className="px-4 py-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                    <span>AI 평가 근거를 불러오지 못했습니다.</span>
                    <button onClick={reloadContrib} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-90 transition-opacity" style={{ background: "var(--primary)" }}>
                      <RefreshCw className="w-3.5 h-3.5" />다시 시도
                    </button>
                  </div>
                )}
                {contribLoadState === "ready" && contribRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">팀원이 없습니다.</div>
                )}
                {contribLoadState === "ready" && contribRows.map((r, i) => {
                  const color = resolveMemberDisplay(r.name, i, String(r.userId)).color;
                  return (
                    <div key={r.userId} className="bg-card rounded-xl border border-border shadow-sm p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: color }}>{r.name[0]}</div>
                        <span className="text-sm font-bold text-foreground">{r.name}</span>
                        <span className="text-[10px] text-muted-foreground">({r.role})</span>
                      </div>
                      <div className="rounded-lg p-3 mb-3 text-xs text-muted-foreground leading-relaxed" style={{ background:"rgba(112,72,232,0.05)", border:"1px solid rgba(112,72,232,0.2)" }}>
                        <div className="flex items-center gap-1.5 mb-1"><Sparkles className="w-3 h-3 text-purple-500" /><strong className="text-foreground">AI 분석 요약</strong></div>
                        {r.aiSummary ?? "AI 요약이 아직 없습니다."}
                      </div>
                      <div className="text-[10px] text-muted-foreground mb-1 font-semibold">근거 출처</div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.evidence.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">근거 없음</span>
                        ) : r.evidence.map((e, idx) => (
                          <span key={idx} className="text-[10px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border cursor-pointer hover:border-blue-400 transition-colors">{e}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Score input tab — REVIEWER ONLY */}
            {panelTab === "score" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 font-medium">최종 평가 점수 입력 — 심사자 전용. 공개 설정 후 팀원에게 노출됩니다.</span>
                </div>
                <div className="space-y-3">
                  {CONTRIB_REPORTS.map(r => (
                    <div key={r.memberId} className="bg-card rounded-xl border border-border shadow-sm p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: r.color }}>{r.name[0]}</div>
                        <div className="flex-1"><div className="text-sm font-bold text-foreground">{r.name}</div><div className="text-[10px] text-muted-foreground">{r.role}</div></div>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100" value={scores[r.memberId]??""} onChange={e => setScores(p=>({...p,[r.memberId]:e.target.value}))}
                            className="w-16 text-center text-sm font-bold rounded-lg border border-border bg-input-background px-2 py-2 outline-none focus:border-blue-400" />
                          <span className="text-sm text-muted-foreground">/ 100</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <textarea rows={1} placeholder="개인 코멘트 (옵션)..." className="flex-1 text-xs rounded-lg border border-border bg-input-background px-3 py-2 outline-none focus:border-blue-400 resize-none mr-3" />
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{publicFlags[r.memberId]?"공개":"비공개"}</span>
                          <div onClick={() => setPublicFlags(p=>({...p,[r.memberId]:!p[r.memberId]}))}
                            className={`w-10 h-5.5 h-[22px] rounded-full flex items-center px-0.5 cursor-pointer transition-colors ${publicFlags[r.memberId]?"bg-blue-500":"bg-muted"}`}>
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${publicFlags[r.memberId]?"translate-x-4.5 translate-x-[18px]":"translate-x-0"}`} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button className="flex-1 py-2.5 text-sm font-bold text-white rounded-xl hover:opacity-90 transition-opacity" style={{ background:"linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                    평가 완료 처리
                  </button>
                  <button className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-border bg-card text-foreground rounded-xl hover:bg-muted transition-colors">
                    <FileText className="w-4 h-4" />리포트 PDF
                  </button>
                </div>
              </div>
            )}

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main MyPage export ───────────────────────────────────────────────────────
export function MyPage() {
  const navigate = useNavigate();
  const { user, currentProject, currentProjectId, logout } = useAuth();

  const role: MyPageRole = currentProject?.role === "심사자" ? "reviewer" : "member";
  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return role === "member"
    ? <MemberMyPage name={name} email={email} onLogout={handleLogout} projectId={currentProjectId} userId={user?.id ?? null} />
    : <ReviewerMyPage name={name} email={email} onLogout={handleLogout} />;
}
