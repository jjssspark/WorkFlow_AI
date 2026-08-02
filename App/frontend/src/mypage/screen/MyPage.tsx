import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../global/hooks/useAuth";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Settings, LogOut, CheckCircle2, Clock, AlertTriangle, Star,
  MessageSquare, Eye, Layers, RefreshCw, Award
} from "lucide-react";
import { StatusBadge } from "../../global/component/StatusBadge";
import { SectionTitle } from "../../global/component/SectionTitle";
import { ProjectSettingsSection } from "./ProjectSettingsSection";
import {
  MEMBER_USER, MY_FEEDBACKS,
} from "../libs/mock/mypage";
import { useMyTasks } from "../libs/hooks/useMyTasks";
import { resolveMemberDisplay } from "../../dashboard/libs/utils/memberDisplay";
import { getDueToday, getDueThisWeek } from "../libs/utils/taskWidgets";
import { getDoneCount, getInProgressCount, getBlockedCount, getTasksByStatus, formatDueDate } from "../../board/libs/utils/taskService";
import type { ProjectRoleKo } from "../../global/api/authTypes";
import { getMyEvaluation, type MyEvaluationDto } from "../../global/api/evaluationApi";
import { fetchMyPersonalComments, replyToPersonalComment, type PersonalCommentDto } from "../libs/api/personalCommentApi";
import { CommentDetailModal, type CommentDetailModalData } from "../components/CommentDetailModal";
import { toast } from "sonner";

// ─── local types ──────────────────────────────────────────────────────────────
export type MyPageRole = "member" | "reviewer";

// Sidebar/Header의 역할 배지와 동일한 배색을 써서 마이페이지 프로필 카드도 같은 UI 언어를 따른다.
const ROLE_COLORS: Record<ProjectRoleKo, string> = {
  "팀장": "#3B5BDB",
  "팀원": "#10B981",
  "심사자": "#7048E8",
};

/** ISO-8601 → "YYYY-MM-DD HH:mm" (개인 코멘트/답글 표시용, 브라우저 로컬 타임존 기준). */
function formatPersonalCommentDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Member My Page ───────────────────────────────────────────────────────────
function MemberMyPage({ name, email, onLogout, projectId, projectContextReady, userId, avatarUrl, affiliation, field, githubUsername, role, projectTitle }: {
  name: string; email: string; onLogout: () => void; projectId: number | null; projectContextReady: boolean; userId: number | null;
  avatarUrl: string | null; affiliation: string | null; field: string[] | null; githubUsername: string | null;
  role: ProjectRoleKo; projectTitle: string | null;
}) {
  const navigate = useNavigate();
  const [taskView, setTaskView] = useState<"all"|"today"|"week">("all");
  const [statusFilter, setStatusFilter] = useState<"all"|"done"|"inprogress"|"blocked"|"todo">("all");
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

  const [searchParams, setSearchParams] = useSearchParams();
  const [personalComments, setPersonalComments] = useState<PersonalCommentDto[]>([]);
  const [personalCommentsLoaded, setPersonalCommentsLoaded] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [detailModal, setDetailModal] = useState<CommentDetailModalData | null>(null);

  const reloadPersonalComments = useCallback(() => {
    // useAuth()가 currentProjectId를 아직 확정하지 못한 콜드 로드 구간에서는 projectId가 일시적으로
    // null로 보인다. 이때 "프로젝트 없음"으로 오판해 목록을 로드 완료 처리하면, 딥링크 effect가
    // 아직 못 찾은 것으로 착각해 거짓 not-found 토스트를 띄운다. projectContextReady가 true가 될
    // 때까지는 로드 완료로 취급하지 않는다.
    if (!projectContextReady) return;
    if (projectId == null) {
      setPersonalComments([]);
      setPersonalCommentsLoaded(true);
      return;
    }
    fetchMyPersonalComments(projectId)
      .then((list) => { setPersonalComments(list); setPersonalCommentsLoaded(true); })
      .catch(() => { setPersonalComments([]); setPersonalCommentsLoaded(true); });
  }, [projectId, projectContextReady]);

  useEffect(() => {
    reloadPersonalComments();
  }, [reloadPersonalComments]);

  const { personalCommentRoots, personalCommentReplyByParentId } = useMemo(() => {
    const roots = personalComments.filter((c) => c.parentId === null);
    const repliesByParent = new Map<number, PersonalCommentDto>();
    personalComments.forEach((c) => {
      if (c.parentId !== null) {
        repliesByParent.set(c.parentId, c);
      }
    });
    return { personalCommentRoots: roots, personalCommentReplyByParentId: repliesByParent };
  }, [personalComments]);

  // 알림 "바로가기"로 들어온 ?commentId=를 소비해 해당 코멘트 스레드 팝업을 자동으로 연다.
  // 목록 로드가 끝나기 전엔 아직 없다고 단정할 수 없으므로 personalCommentsLoaded를 기다린다.
  useEffect(() => {
    const commentIdParam = searchParams.get("commentId");
    if (!commentIdParam || !personalCommentsLoaded) return;
    const commentId = Number(commentIdParam);
    const match = personalComments.find((c) => c.id === commentId);
    if (match) {
      const rootId = match.parentId ?? match.id;
      const root = personalComments.find((c) => c.id === rootId);
      if (root) {
        const reply = personalCommentReplyByParentId.get(root.id);
        setDetailModal({
          title: "심사자 코멘트",
          author: root.authorName,
          dateLabel: formatPersonalCommentDate(root.createdAt),
          content: root.content,
          reply: reply
            ? { author: reply.authorName, dateLabel: formatPersonalCommentDate(reply.createdAt), content: reply.content }
            : undefined,
        });
      }
    } else {
      // 목록 로드가 끝났는데도 못 찾았다 — 삭제됐거나(정리 정책으로 밀려남) 현재 활성 프로젝트가
      // 알림이 가리키는 프로젝트와 달라 조회 대상이 아니다. 파라미터만 조용히 지우면 사용자는
      // 아무 반응도 못 보고 재시도할 방법도 없으므로 토스트로 알린다.
      toast.error("삭제되었거나 다른 프로젝트의 코멘트입니다.");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("commentId");
    setSearchParams(next, { replace: true });
  }, [personalComments, personalCommentsLoaded, personalCommentReplyByParentId, searchParams, setSearchParams]);

  const handleSubmitReply = async (rootId: number) => {
    const draft = (replyDrafts[rootId] ?? "").trim();
    if (!draft || projectId == null) return;
    try {
      await replyToPersonalComment(projectId, rootId, draft);
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[rootId];
        return next;
      });
      reloadPersonalComments();
    } catch (error) {
      // 실패 시 입력값은 유지해 사용자가 다시 시도할 수 있게 한다.
      toast.error(error instanceof Error ? error.message : "답글 전송에 실패했습니다.");
    }
  };

  const { tasks: myTasks, loadState, reload } = useMyTasks(projectId, userId);
  const dueToday = getDueToday(myTasks);
  const dueThisWeek = getDueThisWeek(myTasks);
  const timeFilteredTasks = taskView === "today" ? dueToday : taskView === "week" ? dueThisWeek : myTasks;
  const visibleTasks = statusFilter === "all" ? timeFilteredTasks : timeFilteredTasks.filter(t => t.status === statusFilter);
  const todayNotDone = dueToday.filter(t => t.status !== "done");
  const thisWeekNotDone = dueThisWeek.filter(t => t.status !== "done");

  const taskCounts = {
    done: getDoneCount(myTasks),
    inprogress: getInProgressCount(myTasks),
    blocked: getBlockedCount(myTasks),
    todo: getTasksByStatus("todo", myTasks).length,
  };

  const goToTaskOnBoard = (taskId: string) => navigate(`/board?taskId=${taskId}`);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>

      {/* ── Profile card ── */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-16" style={{ background:"linear-gradient(135deg,#7048E8,#4F6EF7)" }} />
        <div className="px-6 pb-5">
          <div className="flex items-end justify-between -mt-8 mb-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-16 h-16 rounded-2xl border-4 border-white object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-2xl border-4 border-white flex items-center justify-center text-white font-bold text-xl" style={{ background: MEMBER_USER.color }}>
                {initials}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => navigate("/mypage/settings")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border bg-card text-foreground rounded-lg hover:bg-muted transition-colors"><Settings className="w-3.5 h-3.5" />설정</button>
              <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"><LogOut className="w-3.5 h-3.5" />로그아웃</button>
            </div>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold text-foreground">{name}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: ROLE_COLORS[role] }}>{role}</span>
              </div>
              <div className="text-xs text-muted-foreground">{email}</div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{affiliation ?? "소속 미설정"}</span>
                <span className="text-border">·</span>
                <span className="font-medium text-blue-600">{field && field.length > 0 ? field.join(" · ") : "분야 미설정"}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">참여 프로젝트</div>
              <div className="text-sm font-semibold text-foreground">{projectTitle ?? "참여 중인 프로젝트 없음"}</div>
              {githubUsername ? (
                <a
                  href={`https://github.com/${githubUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 mt-1.5 justify-end hover:opacity-80 transition-opacity"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-emerald-600 font-medium">GitHub 연결됨</span>
                  <span className="text-[10px] text-muted-foreground">({githubUsername})</span>
                </a>
              ) : (
                <div className="flex items-center gap-1.5 mt-1.5 justify-end">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-medium">GitHub 미연결</span>
                </div>
              )}
            </div>
          </div>
        </div>
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
              <div className="grid grid-cols-5 gap-3">
                {[
                  { key:"all" as const,        label:"전체", value: myTasks.length,      color:"#3B5BDB", Icon: Star },
                  { key:"done" as const,       label:"완료", value: taskCounts.done,      color:"#10B981", Icon: CheckCircle2 },
                  { key:"inprogress" as const, label:"진행 중", value: taskCounts.inprogress, color:"#3B5BDB", Icon: Clock },
                  { key:"blocked" as const,    label:"검토 필요", value: taskCounts.blocked,    color:"#EF4444", Icon: AlertTriangle },
                  { key:"todo" as const,       label:"대기",   value: taskCounts.todo,       color:"#8892A4", Icon: Layers },
                ].map(s => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setStatusFilter(s.key)}
                    className={`bg-card rounded-xl p-4 border shadow-sm text-center transition-colors ${statusFilter===s.key ? "border-blue-400 ring-2 ring-blue-100" : "border-border hover:border-slate-300"}`}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2" style={{ background:`${s.color}15` }}>
                      <s.Icon className="w-4 h-4" style={{ color: s.color }} />
                    </div>
                    <div className="text-xl font-bold text-foreground">{s.value}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </button>
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
                <div className="p-3 space-y-2">
                  {visibleTasks.length === 0 && (
                    <div className="px-5 py-6 text-center text-xs text-muted-foreground">담당 중인 업무가 없습니다.</div>
                  )}
                  {visibleTasks.map(task => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => goToTaskOnBoard(task.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted hover:border-slate-300 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-12">{task.id}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">{task.title}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{task.category} · 마감 {formatDueDate(task.dueDate)}</div>
                      </div>
                      <StatusBadge status={task.status} />
                    </button>
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
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => goToTaskOnBoard(task.id)}
                        className="w-full flex items-center p-2.5 rounded-lg border border-border bg-muted/30 hover:bg-muted hover:border-slate-300 transition-colors text-left"
                      >
                        <span className="text-xs text-foreground flex-1 truncate">{task.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                <SectionTitle>이번 주 마감</SectionTitle>
                <div className="space-y-2">
                  {thisWeekNotDone.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-3">이번 주 마감인 업무가 없습니다.</div>
                  ) : (
                    thisWeekNotDone.map(task => {
                      const isDueToday = todayNotDone.some(t => t.id === task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => goToTaskOnBoard(task.id)}
                          className="w-full flex items-center justify-between text-xs p-2.5 rounded-lg border border-border bg-muted/30 hover:bg-muted hover:border-slate-300 transition-colors text-left"
                        >
                          <span className="text-foreground truncate flex-1">{task.title}</span>
                          <span className={`font-bold ml-2 shrink-0 ${isDueToday?"text-amber-600":"text-muted-foreground"}`}>{formatDueDate(task.dueDate)}</span>
                        </button>
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
                      <div className="grid grid-cols-4 gap-2 mb-3 text-center">
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
                          <div className="text-2xl font-bold text-foreground">
                            {myEvaluation?.finalRevealed && myEvaluation.totalScore != null
                              ? myEvaluation.totalScore.toFixed(2)
                              : "-"}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">총합</div>
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
                  심사자가 공개한 심사 코멘트/팀장·AI 피드백은 기존 카드 그대로 유지하고,
                  심사자가 남긴 개인 코멘트+답글(실 데이터, 최대 10건)을 그 사이에 추가한다.
                  모든 카드는 클릭하면 상세 팝업이 뜬다. */}
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border"><SectionTitle>개인 코멘트 / 피드백</SectionTitle></div>
                <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
                  {myEvaluation?.commentRevealed && myEvaluation.comment && (
                    <button
                      type="button"
                      onClick={() => setDetailModal({ title: "심사자 코멘트", author: "심사자", content: myEvaluation.comment as string })}
                      className="w-full text-left rounded-xl p-3.5 border border-emerald-200 bg-emerald-50/40"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold bg-emerald-600">심</div>
                        <span className="text-[11px] font-semibold text-foreground">심사자 코멘트</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{myEvaluation.comment}</p>
                    </button>
                  )}
                  {personalCommentRoots.map((root) => {
                    const reply = personalCommentReplyByParentId.get(root.id);
                    return (
                      <div key={root.id} className="rounded-xl p-3.5 border border-blue-200 bg-blue-50/40">
                        <button
                          type="button"
                          onClick={() => setDetailModal({
                            title: "심사자 코멘트",
                            author: root.authorName,
                            dateLabel: formatPersonalCommentDate(root.createdAt),
                            content: root.content,
                            reply: reply
                              ? { author: reply.authorName, dateLabel: formatPersonalCommentDate(reply.createdAt), content: reply.content }
                              : undefined,
                          })}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold bg-blue-600">심</div>
                            <span className="text-[11px] font-semibold text-foreground">{root.authorName}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{formatPersonalCommentDate(root.createdAt)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{root.content}</p>
                        </button>
                        {reply ? (
                          <div className="mt-2 ml-4 pl-3 border-l-2 border-blue-200">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-semibold text-foreground">답글 · {reply.authorName}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">{formatPersonalCommentDate(reply.createdAt)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{reply.content}</p>
                          </div>
                        ) : (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={replyDrafts[root.id] ?? ""}
                              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [root.id]: e.target.value }))}
                              placeholder="답글 작성..."
                              className="flex-1 text-xs rounded-lg border border-border bg-input-background px-3 py-1.5 outline-none focus:border-blue-400"
                            />
                            <button
                              type="button"
                              onClick={() => handleSubmitReply(root.id)}
                              disabled={!(replyDrafts[root.id] ?? "").trim()}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40"
                            >
                              <MessageSquare className="w-3 h-3" />답글
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {MY_FEEDBACKS.map((f, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDetailModal({ title: f.type === "ai" ? "AI 활동 분석" : "팀장 피드백", author: f.from, dateLabel: f.date, content: f.content })}
                      className={`w-full text-left rounded-xl p-3.5 border ${f.type==="ai"?"border-purple-200 bg-purple-50/40":"border-border bg-muted/30"}`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: f.type==="ai"?"#7048E8":"#3B5BDB" }}>
                          {f.type==="ai"?"AI":f.from[0]}
                        </div>
                        <span className="text-[11px] font-semibold text-foreground">{f.from}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{f.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{f.content}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {detailModal && <CommentDetailModal data={detailModal} onClose={() => setDetailModal(null)} />}
    </div>
  );
}

// ─── Main MyPage export ───────────────────────────────────────────────────────
export function MyPage() {
  const navigate = useNavigate();
  const { user, currentProject, currentProjectId, projectContextReady, logout } = useAuth();

  const role: MyPageRole = currentProject?.role === "심사자" ? "reviewer" : "member";
  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  // 심사자에게는 마이페이지가 없다 - 심사 업무는 기여도 분석 화면에서 처리한다.
  if (role === "reviewer") return <Navigate to="/contributors" replace />;

  return (
    <MemberMyPage
      name={name} email={email} onLogout={handleLogout} projectId={currentProjectId} projectContextReady={projectContextReady} userId={user?.id ?? null}
      avatarUrl={user?.avatarUrl ?? null} affiliation={user?.affiliation ?? null} field={user?.field ?? null} githubUsername={user?.githubUsername ?? null}
      role={currentProject?.role ?? "팀원"} projectTitle={currentProject?.projectTitle ?? null}
    />
  );
}
