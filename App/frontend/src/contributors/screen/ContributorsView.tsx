import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Award,
  BarChart3,
  Calculator,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { fetchAttendanceSummary, type MeetingAttendanceSummaryDto } from "../../meetings/libs/utils/meetingAiApi";
import { fetchContributionReport, fetchContributionScore, type MemberContributionDto, type ContributionMemberScoreDto } from "../libs/utils/contributorsApi";
import { fetchTasks } from "../../board/libs/utils/taskApi";
import type { Task } from "../../board/libs/types/task";
import {
  finalizeEvaluation,
  getProject,
  getProjectMembers,
  type MemberResponse,
  type ProjectResponse,
} from "../../global/api/projectsApi";
import {
  getEvaluationScores,
  getEvaluationSettings,
  upsertEvaluationScore,
  upsertEvaluationSettings,
  type EvaluationScoreUpdate,
} from "../../global/api/evaluationApi";
import { MemberDrilldownPanel } from "../components/MemberDrilldownPanel";
import { useAuth } from "../../global/hooks/useAuth";
import { EVAL_STATUS_META, resolveEvalStatus } from "../../global/lib/evalStatus";

type CategoryKey = "workload" | "task" | "meeting";

// 평가 대상 표시용 아바타 색상 — dashboard/libs/utils/memberDisplay.ts와 동일한 팔레트를 재사용해
// 화면 간 같은 팀원이 다른 색으로 보이는 혼란을 피한다.
const MEMBER_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"];
function hashSeed(seed: string): number {
  return [...seed].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}
function colorForMember(userId: number): string {
  return MEMBER_COLORS[Math.abs(hashSeed(String(userId))) % MEMBER_COLORS.length];
}

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  workload: "업무 편중도",
  task: "업무 수행",
  meeting: "회의 참여",
};

function scoreTone(score: number) {
  if (score >= 90) return { label: "우수", color: "#2563EB", bg: "#EFF6FF" };
  if (score >= 80) return { label: "양호", color: "#059669", bg: "#ECFDF5" };
  if (score >= 70) return { label: "주의", color: "#D97706", bg: "#FFFBEB" };
  return { label: "검토 필요", color: "#DC2626", bg: "#FEF2F2" };
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

// 학점 계산기 드롭다운 옵션 — 학교마다 표기 관례가 달라(A0 계열/A 계열 모두 지원, Pass/Fail 트랙)
// value는 백엔드 CHECK 제약(chk_evaluation_scores_grade)과 동일한 저장값이고,
// label만 화면 표시용으로 다르게 보여준다(P→Pass, F→Fail).
const GRADE_OPTIONS = [
  { value: "A+", label: "A+" },
  { value: "A", label: "A" },
  { value: "A0", label: "A0" },
  { value: "A-", label: "A-" },
  { value: "B+", label: "B+" },
  { value: "B", label: "B" },
  { value: "B0", label: "B0" },
  { value: "B-", label: "B-" },
  { value: "C+", label: "C+" },
  { value: "C", label: "C" },
  { value: "C0", label: "C0" },
  { value: "C-", label: "C-" },
  { value: "D+", label: "D+" },
  { value: "D", label: "D" },
  { value: "D0", label: "D0" },
  { value: "D-", label: "D-" },
  { value: "F", label: "Fail" },
  { value: "P", label: "Pass" },
  { value: "NP", label: "NP" },
] as const;

type TotalSortOrder = "asc" | "desc" | null;

export function ContributorsView() {
  const navigate = useNavigate();
  const { currentProjectId } = useAuth();
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [query, setQuery] = useState("");
  // 심사 코멘트 — 선택된 팀원에게 남길 메모. 서버의 comment로 초기 seed되고, 저장 버튼으로
  // evaluation_scores.comment에 영속화된다(공개 여부는 commentPublicFlags로 독립 관리).
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSavingMemberId, setCommentSavingMemberId] = useState<string | null>(null);
  const [commentSaveErrorByMemberId, setCommentSaveErrorByMemberId] = useState<Record<string, string | null>>({});
  // 프로젝트 상세(제목, eval_status 등) — 실제 API 응답. 실패하면 null 유지(제목/배지 미표시).
  const [project, setProject] = useState<ProjectResponse | null>(null);
  useEffect(() => {
    if (currentProjectId == null) {
      setProject(null);
      return;
    }
    getProject(currentProjectId).then(setProject).catch(() => setProject(null));
  }, [currentProjectId]);
  // "평가 확정" 버튼 상태 — 클릭 시 finalize-evaluation 호출, 성공하면 project를 갱신해
  // 배지가 "평가 중" → "평가 완료"로 즉시 바뀌게 한다.
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const handleFinalizeEvaluation = async () => {
    if (currentProjectId == null) return;
    setIsFinalizing(true);
    setFinalizeError(null);
    try {
      const updated = await finalizeEvaluation(currentProjectId);
      setProject(updated);
    } catch {
      setFinalizeError("평가를 확정하지 못했습니다.");
    } finally {
      setIsFinalizing(false);
    }
  };
  // 평가 대상 목록 — 실제 프로젝트 멤버(심사자는 평가 대상이 아니므로 제외).
  const [members, setMembers] = useState<MemberResponse[]>([]);
  useEffect(() => {
    if (currentProjectId == null) {
      setMembers([]);
      return;
    }
    getProjectMembers(currentProjectId)
      .then((result) => setMembers(result.filter((m) => m.role !== "심사자")))
      .catch(() => setMembers([]));
  }, [currentProjectId]);
  // 실제 회의 참석 데이터로 회의 참여 지표를 채운다. 실패하면 빈 배열(회의 컬럼 미표시).
  const [attendanceSummaries, setAttendanceSummaries] = useState<MeetingAttendanceSummaryDto[]>([]);
  useEffect(() => {
    if (currentProjectId == null) {
      setAttendanceSummaries([]);
      return;
    }
    fetchAttendanceSummary(String(currentProjectId)).then(setAttendanceSummaries).catch(() => setAttendanceSummaries([]));
  }, [currentProjectId]);
  const attendanceByMemberId = useMemo(
    () => Object.fromEntries(attendanceSummaries.map((summary) => [String(summary.userId), summary])),
    [attendanceSummaries],
  );
  // 업무 수행 드릴다운 패널용 프로젝트 전체 업무 목록. 실패하면 빈 배열로 폴백(패널은 빈 상태로 표시).
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  useEffect(() => {
    if (currentProjectId == null) {
      setProjectTasks([]);
      return;
    }
    fetchTasks(currentProjectId).then(setProjectTasks).catch(() => setProjectTasks([]));
  }, [currentProjectId]);
  const [drilldown, setDrilldown] = useState<{ mode: "tasks" | "meetings" | "workload"; memberId: string } | null>(null);
  // 실제 기여 점수로 목업 score/categories를 보강한다. 실패하면 목업 값을 그대로 쓴다.
  const [contributionScores, setContributionScores] = useState<ContributionMemberScoreDto[]>([]);
  // anomaly_type(과부하/배정량 불균형) 판정에 실제로 쓰인 팀 평균 완료율 — 편중도 근거
  // 패널이 "팀 평균보다 높음/낮음" 문구의 실측 근거로 함께 보여준다.
  const [teamMeanCompletion, setTeamMeanCompletion] = useState<number | null>(null);
  useEffect(() => {
    if (currentProjectId == null) {
      setContributionScores([]);
      setTeamMeanCompletion(null);
      return;
    }
    fetchContributionScore(currentProjectId)
      .then((result) => {
        setContributionScores(result.members);
        setTeamMeanCompletion(result.teamMeanCompletion);
      })
      .catch(() => {
        setContributionScores([]);
        setTeamMeanCompletion(null);
      });
  }, [currentProjectId]);
  const contributionByMemberId = useMemo(
    () => Object.fromEntries(contributionScores.map((s) => [s.assigneeId, s])),
    [contributionScores],
  );
  // 팀원별 실제 배정 업무(전체 업무 목록에서 assignee가 본인인 것만).
  const tasksByMemberId = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of projectTasks) {
      if (!task.assignee) continue;
      const list = grouped.get(task.assignee) ?? [];
      list.push(task);
      grouped.set(task.assignee, list);
    }
    return grouped;
  }, [projectTasks]);
  // 세 공개 플래그는 evaluation_scores 테이블에 각각 독립 컬럼으로 영속화된다 —
  // 기여 점수(왼쪽 테이블), 총합/심사자 점수/학점(학점 계산기), 심사 코멘트를 심사자가
  // 서로 다른 시점에 따로 공개할 수 있어야 하기 때문이다(중간 점검용 공개 vs 최종 확정 공개).
  const [contributionPublicFlags, setContributionPublicFlags] = useState<Record<string, boolean>>({});
  const [finalPublicFlags, setFinalPublicFlags] = useState<Record<string, boolean>>({});
  const [commentPublicFlags, setCommentPublicFlags] = useState<Record<string, boolean>>({});
  const [publicFlagError, setPublicFlagError] = useState<string | null>(null);
  // 학점 계산기 입력값 — 서버의 reviewerScore/grade로 초기 seed되고, 이후 입력에 따라 갱신된다.
  const [evaluationDrafts, setEvaluationDrafts] = useState<Record<string, { reviewerScore: string; grade: string }>>({});
  useEffect(() => {
    if (currentProjectId == null) {
      setContributionPublicFlags({});
      setFinalPublicFlags({});
      setCommentPublicFlags({});
      setEvaluationDrafts({});
      setCommentDrafts({});
      return;
    }
    getEvaluationScores(currentProjectId)
      .then((scores) => {
        const fillDefaults = (record: Record<string, boolean>) => {
          const next = { ...record };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = false;
          }
          return next;
        };
        setContributionPublicFlags((prev) => {
          const next = fillDefaults(prev);
          for (const s of scores) next[String(s.userId)] = s.contributionPublic;
          return next;
        });
        setFinalPublicFlags((prev) => {
          const next = fillDefaults(prev);
          for (const s of scores) next[String(s.userId)] = s.finalPublic;
          return next;
        });
        setCommentPublicFlags((prev) => {
          const next = fillDefaults(prev);
          for (const s of scores) next[String(s.userId)] = s.commentPublic;
          return next;
        });
        setEvaluationDrafts((prev) => {
          const next = { ...prev };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = { reviewerScore: "", grade: "" };
          }
          for (const s of scores) {
            next[String(s.userId)] = {
              reviewerScore: s.reviewerScore != null ? String(s.reviewerScore) : "",
              grade: s.grade ?? "",
            };
          }
          return next;
        });
        setCommentDrafts((prev) => {
          const next = { ...prev };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = "";
          }
          for (const s of scores) {
            next[String(s.userId)] = s.comment ?? "";
          }
          return next;
        });
      })
      .catch(() => {
        // 조회 실패 시 멤버별 기본값(비공개/빈 입력)만이라도 채워서 화면이 항상 렌더된다.
        const fillDefaults = (record: Record<string, boolean>) => {
          const next = { ...record };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = false;
          }
          return next;
        };
        setContributionPublicFlags(fillDefaults);
        setFinalPublicFlags(fillDefaults);
        setCommentPublicFlags(fillDefaults);
        setEvaluationDrafts((prev) => {
          const next = { ...prev };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = { reviewerScore: "", grade: "" };
          }
          return next;
        });
        setCommentDrafts((prev) => {
          const next = { ...prev };
          for (const member of members) {
            const key = String(member.userId);
            if (!(key in next)) next[key] = "";
          }
          return next;
        });
      });
  }, [currentProjectId, members]);

  // 세 공개 토글 공통 처리 — update에 해당 플래그만 담아 보내므로 다른 두 플래그와
  // score/reviewerScore/grade/comment는 서버에서 그대로 유지된다(독립성 보장).
  const toggleFlag = async (
    memberId: string,
    flags: Record<string, boolean>,
    setFlags: Dispatch<SetStateAction<Record<string, boolean>>>,
    update: (nextValue: boolean) => EvaluationScoreUpdate,
  ) => {
    if (currentProjectId == null) return;
    const wasPublic = flags[memberId] ?? false;
    const nextIsPublic = !wasPublic;
    // 낙관적 업데이트 — 실패하면 원래 값으로 되돌린다.
    setFlags((prev) => ({ ...prev, [memberId]: nextIsPublic }));
    setPublicFlagError(null);
    try {
      await upsertEvaluationScore(currentProjectId, Number(memberId), update(nextIsPublic));
    } catch {
      setFlags((prev) => ({ ...prev, [memberId]: wasPublic }));
      setPublicFlagError("공개 여부를 저장하지 못했습니다.");
    }
  };

  const toggleContributionPublic = (memberId: string) =>
    toggleFlag(memberId, contributionPublicFlags, setContributionPublicFlags, (nextValue) => ({
      contributionPublic: nextValue,
    }));
  const toggleFinalPublic = (memberId: string) =>
    toggleFlag(memberId, finalPublicFlags, setFinalPublicFlags, (nextValue) => ({ finalPublic: nextValue }));
  const toggleCommentPublic = (memberId: string) =>
    toggleFlag(memberId, commentPublicFlags, setCommentPublicFlags, (nextValue) => ({ commentPublic: nextValue }));

  // 학점 계산기 — 점수 비율(기여 점수 %)은 프로젝트 공통 값으로 서버에 영속화된다.
  const [contributionRatio, setContributionRatio] = useState(40);
  const [ratioError, setRatioError] = useState<string | null>(null);
  useEffect(() => {
    if (currentProjectId == null) return;
    getEvaluationSettings(currentProjectId)
      .then((setting) => setContributionRatio(setting.contributionRatio))
      .catch(() => {
        // 조회 실패 시 기본값(40%) 유지 — 화면은 그대로 동작하게 둔다.
      });
  }, [currentProjectId]);

  const handleRatioCommit = async (nextRatio: number) => {
    if (currentProjectId == null) return;
    const clamped = Math.min(100, Math.max(0, nextRatio));
    const previous = contributionRatio;
    setContributionRatio(clamped);
    setRatioError(null);
    try {
      await upsertEvaluationSettings(currentProjectId, clamped);
    } catch {
      setContributionRatio(previous);
      setRatioError("점수 비율을 저장하지 못했습니다.");
    }
  };

  const [calculatorSort, setCalculatorSort] = useState<TotalSortOrder>(null);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [saveErrorByMemberId, setSaveErrorByMemberId] = useState<Record<string, string | null>>({});

  const handleGradeCalculatorSave = async (memberId: string, total: number | null) => {
    if (currentProjectId == null || total == null) return;
    const draft = evaluationDrafts[memberId];
    const reviewerScoreNum = draft ? Number(draft.reviewerScore) : NaN;
    setSavingMemberId(memberId);
    setSaveErrorByMemberId((prev) => ({ ...prev, [memberId]: null }));
    try {
      // finalPublic/contributionPublic/commentPublic은 보내지 않는다(undefined) — 저장 버튼은
      // 총합/심사자점수/학점만 확정하고, 공개 여부는 별도의 "공개" 토글로만 바뀌어야 한다.
      // total은 학점 계산기가 계산한 최종 총합이므로 totalScore로 저장한다 — score(AI 기여
      // 점수)를 여기서 덮어쓰면 안 된다(과거 버그: score 필드를 공유해 기여 점수가 사라졌었다).
      await upsertEvaluationScore(currentProjectId, Number(memberId), {
        totalScore: total,
        reviewerScore: reviewerScoreNum,
        grade: draft?.grade || undefined,
      });
    } catch {
      setSaveErrorByMemberId((prev) => ({ ...prev, [memberId]: "저장하지 못했습니다." }));
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleCommentSave = async (memberId: string) => {
    if (currentProjectId == null) return;
    const comment = commentDrafts[memberId] ?? "";
    setCommentSavingMemberId(memberId);
    setCommentSaveErrorByMemberId((prev) => ({ ...prev, [memberId]: null }));
    try {
      // contributionPublic/finalPublic/commentPublic은 보내지 않는다(undefined) — 코멘트
      // 내용 저장은 공개 여부를 바꾸지 않는다(별도의 "공개 중" 토글로만 바뀐다).
      await upsertEvaluationScore(currentProjectId, Number(memberId), { comment });
    } catch {
      setCommentSaveErrorByMemberId((prev) => ({ ...prev, [memberId]: "저장하지 못했습니다." }));
    } finally {
      setCommentSavingMemberId(null);
    }
  };

  const [reportOverrides, setReportOverrides] = useState<Record<string, { summary: string; evidence: string[] }>>({});
  const [isRefreshingReport, setIsRefreshingReport] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const mergedReports = useMemo(
    () =>
      members.map((member) => {
        const memberId = String(member.userId);
        const override = reportOverrides[memberId];
        const scoreData = contributionByMemberId[memberId];
        const memberTasks = tasksByMemberId.get(memberId) ?? [];
        const todoDone = memberTasks.filter((task) => task.status === "done").length;
        const todoTotal = memberTasks.length;
        const attendance = attendanceByMemberId[memberId];
        return {
          memberId,
          name: member.name,
          role: member.role,
          color: colorForMember(member.userId),
          todoDone,
          todoTotal,
          meetings: attendance?.meetingsAttended ?? 0,
          aiSummary: override?.summary ?? "아직 AI 분석 요약이 생성되지 않았습니다. \"리포트 새로고침\"을 눌러 생성해주세요.",
          evidence: override?.evidence ?? [],
          // 소수 둘째 자리까지 유지 — 학점 계산기 총합 계산의 정밀도를 위해 반올림하지 않는다.
          // 표시할 때는 각 자리에서 필요에 맞게 포맷한다(toFixed(2) 또는 Math.round).
          score: scoreData ? scoreData.contributionScore : 0,
          categories: scoreData
            ? { task: scoreData.taskComponent, meeting: scoreData.meetingComponent, workload: scoreData.workloadComponent }
            : { task: 0, meeting: 0, workload: 0 },
        };
      }),
    [members, reportOverrides, contributionByMemberId, tasksByMemberId, attendanceByMemberId],
  );

  const handleRefreshReport = async () => {
    if (currentProjectId == null) return;
    setIsRefreshingReport(true);
    setRefreshError(null);
    try {
      const reports = await fetchContributionReport(currentProjectId);
      setReportOverrides(
        Object.fromEntries(
          reports.map((report: MemberContributionDto) => [
            String(report.userId),
            { summary: report.summary, evidence: report.evidence },
          ]),
        ),
      );
    } catch {
      setRefreshError("기여도 리포트를 새로고침하지 못했습니다.");
    } finally {
      setIsRefreshingReport(false);
    }
  };

  const filteredReports = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return mergedReports;
    return mergedReports.filter((report) => {
      const haystack = [
        report.name,
        report.role,
        report.aiSummary,
        ...report.evidence,
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [query, mergedReports]);

  const selectedMember = mergedReports.find((report) => report.memberId === selectedMemberId) ?? mergedReports[0] ?? null;
  const averageScore = mergedReports.length > 0
    ? Math.round(mergedReports.reduce((sum, report) => sum + report.score, 0) / mergedReports.length)
    : 0;
  // "공개 완료" 카드는 최종 확정(총합/학점) 기준으로 센다 — 기여 점수만 먼저 공개된
  // 중간 점검 상태는 아직 "완료"로 보지 않는다.
  const publishedCount = Object.values(finalPublicFlags).filter(Boolean).length;
  const completedTasks = mergedReports.reduce((sum, report) => sum + report.todoDone, 0);
  const totalTasks = mergedReports.reduce((sum, report) => sum + report.todoTotal, 0);
  const statusMeta = EVAL_STATUS_META[resolveEvalStatus(project?.evalStatus)];
  const isPublished = resolveEvalStatus(project?.evalStatus) === "PUBLISHED";
  const selectedTone = scoreTone(selectedMember?.score ?? 0);

  // 총합 = 기여점수 × (비율/100) + 심사자점수 × ((100-비율)/100), 소수 둘째 자리 반올림.
  // 심사자점수가 아직 입력되지 않았으면(빈 문자열/NaN) 계산하지 않고 null을 반환한다.
  const calculateTotal = (contributionScore: number, reviewerScoreInput: string): number | null => {
    const reviewerScoreNum = Number(reviewerScoreInput);
    if (reviewerScoreInput.trim() === "" || Number.isNaN(reviewerScoreNum)) return null;
    const weighted =
      contributionScore * (contributionRatio / 100) + reviewerScoreNum * ((100 - contributionRatio) / 100);
    return Math.round(weighted * 100) / 100;
  };

  const calculatorRows = useMemo(() => {
    const rows = mergedReports.map((report) => {
      const draft = evaluationDrafts[report.memberId] ?? { reviewerScore: "", grade: "" };
      const total = calculateTotal(report.score, draft.reviewerScore);
      return { ...report, draft, total };
    });
    if (calculatorSort == null) return rows;
    const sorted = [...rows].sort((a, b) => {
      const totalA = a.total ?? -Infinity;
      const totalB = b.total ?? -Infinity;
      return calculatorSort === "asc" ? totalA - totalB : totalB - totalA;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedReports, evaluationDrafts, contributionRatio, calculatorSort]);

  return (
    <div
      className="h-full overflow-y-auto bg-background"
      style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}
    >
      <div className="w-full max-w-[1480px] mx-auto p-4 sm:p-5 lg:p-6 space-y-5">
        <section className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate("/projects")}
              className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              프로젝트 목록으로
            </button>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-blue-600">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground leading-tight">기여도 분석</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  업무, 회의록, 산출물 데이터를 기반으로 개인별 기여도를 검토합니다.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-1 rounded-md bg-muted text-foreground font-semibold">심사자 전용</span>
              <span>팀원에게는 공개 처리된 최종 점수와 코멘트만 노출됩니다.</span>
            </div>
            {refreshError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{refreshError}</p>
            )}
            {publicFlagError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{publicFlagError}</p>
            )}
            {finalizeError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{finalizeError}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefreshReport}
              disabled={isRefreshingReport || currentProjectId == null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingReport ? "animate-spin" : ""}`} />
              {isRefreshingReport ? "새로고침 중..." : "리포트 새로고침"}
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors">
              <Download className="w-3.5 h-3.5" />
              PDF 저장
            </button>
            <button
              type="button"
              onClick={handleFinalizeEvaluation}
              disabled={isFinalizing || isPublished || currentProjectId == null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isFinalizing ? "확정 중..." : isPublished ? "평가 완료됨" : "평가 확정"}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: "팀 평균 점수", value: `${averageScore}점`, icon: Award, color: "#2563EB" },
            { label: "평가 대상", value: `${mergedReports.length}명`, icon: Users, color: "#7C3AED" },
            { label: "공개 완료", value: `${publishedCount}/${mergedReports.length}`, icon: Eye, color: "#059669" },
            { label: "전체 업무 완료율", value: `${percent(completedTasks, totalTasks)}%`, icon: CheckCircle2, color: "#D97706" },
          ].map((item) => (
            <div key={item.label} className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-muted-foreground">{item.label}</div>
                  <div className="text-2xl font-bold text-foreground mt-1">{item.value}</div>
                </div>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${item.color}14` }}>
                  <item.icon className="w-4 h-4" style={{ color: item.color }} />
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <main className="space-y-4 min-w-0">
            <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">{project?.title ?? ""}</h2>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                    style={{ color: statusMeta.color, background: statusMeta.bg, borderColor: statusMeta.border }}
                  >
                    {statusMeta.label}
                  </span>
                </div>
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="이름, 역할, 근거 검색"
                    className="w-full rounded-lg border border-border bg-input-background pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-400"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="grid grid-cols-[56px_150px_90px_90px_90px_84px_86px] px-5 py-2.5 bg-muted/40 border-b border-border text-[11px] font-bold text-muted-foreground">
                    <div className="text-center">순위</div>
                    <div>이름/역할</div>
                    <div className="text-center">기여 점수</div>
                    <div className="text-center">업무 수행</div>
                    <div className="text-center">회의 참여</div>
                    <div className="text-center">업무 편중도</div>
                    <div className="text-center">공개</div>
                  </div>

                  <div className="divide-y divide-border">
                    {filteredReports.map((report, index) => {
                      const isSelected = selectedMember?.memberId === report.memberId;
                      const tone = scoreTone(report.score);
                      const taskRate = percent(report.todoDone, report.todoTotal);
                      return (
                        <div
                          key={report.memberId}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedMemberId(report.memberId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedMemberId(report.memberId);
                            }
                          }}
                          className={`grid grid-cols-[56px_150px_90px_90px_90px_84px_86px] w-full items-center px-5 py-3 text-left transition-colors cursor-pointer ${
                            isSelected ? "bg-blue-50" : "hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-foreground bg-muted">
                              {index + 1}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                              style={{ background: report.color }}
                            >
                              {report.name[0]}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-foreground truncate">{report.name}</div>
                              <div className="text-[11px] text-muted-foreground">{report.role}</div>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-bold" style={{ color: tone.color }}>{report.score.toFixed(2)}</div>
                            <div className="text-[10px] font-semibold" style={{ color: tone.color }}>{tone.label}</div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedMemberId(report.memberId);
                              setDrilldown({ mode: "tasks", memberId: report.memberId });
                            }}
                            className="w-full bg-transparent border-0 p-0 text-xs text-foreground text-center hover:underline cursor-pointer"
                          >
                            <span className="font-bold">{report.todoDone}</span>
                            <span className="text-muted-foreground">/{report.todoTotal}</span>
                            <span className="block text-[10px] text-muted-foreground">{taskRate}%</span>
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedMemberId(report.memberId);
                              setDrilldown({ mode: "meetings", memberId: report.memberId });
                            }}
                            className="w-full bg-transparent border-0 p-0 text-xs text-foreground text-center hover:underline cursor-pointer"
                          >
                            {attendanceByMemberId[report.memberId] ? (
                              <>
                                <span className="font-bold">{attendanceByMemberId[report.memberId].meetingsAttended}</span>
                                <span className="text-muted-foreground">/{attendanceByMemberId[report.memberId].totalMeetings}회</span>
                                <span className="block text-[10px] text-muted-foreground">{attendanceByMemberId[report.memberId].attendanceRate}%</span>
                              </>
                            ) : (
                              <span className="font-bold">{report.meetings}회</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedMemberId(report.memberId);
                              setDrilldown({ mode: "workload", memberId: report.memberId });
                            }}
                            className="w-full bg-transparent border-0 p-0 text-xs text-foreground text-center hover:underline cursor-pointer"
                          >
                            <span className="font-bold">{report.categories.workload}</span>
                          </button>
                          <div className="text-center">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleContributionPublic(report.memberId);
                              }}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full cursor-pointer transition-colors ${
                                contributionPublicFlags[report.memberId]
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
                              }`}
                            >
                              {contributionPublicFlags[report.memberId] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              {contributionPublicFlags[report.memberId] ? "공개" : "비공개"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {selectedMember == null ? (
              <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground shadow-sm">
                평가 대상 팀원이 없습니다.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="bg-card border border-border rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <h3 className="text-sm font-bold text-foreground">AI 분석 요약</h3>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{selectedMember.aiSummary}</p>
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      AI 분석은 평가 보조 자료입니다. 최종 점수와 공개 여부는 심사자가 확정해야 합니다.
                    </p>
                  </div>
                </section>

                <section className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0"
                          style={{ background: selectedMember.color }}
                        >
                          {selectedMember.name[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="text-base font-bold text-foreground truncate">{selectedMember.name}</div>
                          <div className="text-xs text-muted-foreground">{selectedMember.role}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-3xl font-bold" style={{ color: selectedTone.color }}>{selectedMember.score.toFixed(2)}</div>
                        <div
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ color: selectedTone.color, background: selectedTone.bg }}
                        >
                          {selectedTone.label}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {Object.entries(selectedMember.categories).map(([key, value]) => (
                      <div key={key}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{CATEGORY_LABELS[key as CategoryKey]}</span>
                          <span className="font-bold text-foreground">{value}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${value}%`, background: selectedMember.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </main>

          <aside className="space-y-4 min-w-0">
            <div className="grade-calculator-card bg-card border border-border rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-blue-600" />
                  <h3 className="text-base font-bold text-foreground">학점 계산기</h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>점수 비율: 기여</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={contributionRatio}
                    onChange={(event) => setContributionRatio(Number(event.target.value))}
                    onBlur={(event) => handleRatioCommit(Number(event.target.value))}
                    className="w-14 rounded-md border border-border bg-input-background px-2 py-1 text-center text-xs outline-none focus:border-blue-400"
                  />
                  <span>% / 심사자 {100 - contributionRatio}%(자동)</span>
                </div>
                {ratioError && <p className="text-xs font-semibold text-red-600">{ratioError}</p>}
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[minmax(96px,1fr)_84px_100px_100px_100px_84px_84px] px-4 py-3 bg-muted/40 border-b border-border text-[11px] font-bold text-muted-foreground">
                    <div>이름</div>
                    <div className="text-center">기여 점수</div>
                    <div className="text-center">심사자 점수</div>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setCalculatorSort((prev) => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"))
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-bold hover:text-foreground transition-colors cursor-pointer"
                      >
                        총합
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-center">학점</div>
                    <div className="text-center">공개</div>
                    <div className="text-center">저장</div>
                  </div>

                  <div className="divide-y divide-border">
                    {calculatorRows.map((row) => {
                      const saveError = saveErrorByMemberId[row.memberId];
                      return (
                        <div
                          key={row.memberId}
                          className="grid grid-cols-[minmax(96px,1fr)_84px_100px_100px_100px_84px_84px] items-center px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="calculator-row-name text-sm font-bold text-foreground truncate">{row.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{row.role}</div>
                            {saveError && <div className="text-[10px] font-semibold text-red-600">{saveError}</div>}
                          </div>
                          <div className="text-center text-sm font-semibold text-foreground">{row.score.toFixed(2)}</div>
                          <div className="text-center">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={row.draft.reviewerScore}
                              onChange={(event) =>
                                setEvaluationDrafts((prev) => ({
                                  ...prev,
                                  [row.memberId]: { ...row.draft, reviewerScore: event.target.value },
                                }))
                              }
                              placeholder="-"
                              className="w-20 rounded-md border border-border bg-input-background px-1.5 py-1.5 text-center text-sm outline-none focus:border-blue-400"
                            />
                          </div>
                          <div className="text-center text-sm font-bold text-foreground">
                            {row.total != null ? row.total.toFixed(2) : "-"}
                          </div>
                          <div className="text-center">
                            <select
                              value={row.draft.grade}
                              onChange={(event) =>
                                setEvaluationDrafts((prev) => ({
                                  ...prev,
                                  [row.memberId]: { ...row.draft, grade: event.target.value },
                                }))
                              }
                              className="w-20 rounded-md border border-border bg-input-background px-1 py-1.5 text-center text-sm outline-none focus:border-blue-400"
                            >
                              <option value="">-</option>
                              {GRADE_OPTIONS.map((grade) => (
                                <option key={grade.value} value={grade.value}>
                                  {grade.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="text-center">
                            <button
                              type="button"
                              onClick={() => toggleFinalPublic(row.memberId)}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full cursor-pointer transition-colors ${
                                finalPublicFlags[row.memberId]
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
                              }`}
                            >
                              {finalPublicFlags[row.memberId] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              {finalPublicFlags[row.memberId] ? "공개" : "비공개"}
                            </button>
                          </div>
                          <div className="text-center">
                            <button
                              type="button"
                              disabled={row.total == null || savingMemberId === row.memberId}
                              onClick={() => handleGradeCalculatorSave(row.memberId, row.total)}
                              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {savingMemberId === row.memberId ? "저장 중" : "저장"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {selectedMember != null && (
              <section className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-bold text-foreground">심사 코멘트</h3>
                </div>
                <textarea
                  value={commentDrafts[selectedMember.memberId] ?? ""}
                  onChange={(event) =>
                    setCommentDrafts((prev) => ({ ...prev, [selectedMember.memberId]: event.target.value }))
                  }
                  rows={4}
                  placeholder={`${selectedMember.name}에게 남길 평가 코멘트를 입력하세요.`}
                  className="w-full resize-none rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none focus:border-blue-400"
                />
                {commentSaveErrorByMemberId[selectedMember.memberId] && (
                  <p className="mt-1 text-[10px] font-semibold text-red-600">
                    {commentSaveErrorByMemberId[selectedMember.memberId]}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => toggleCommentPublic(selectedMember.memberId)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                  >
                    {commentPublicFlags[selectedMember.memberId] ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    {commentPublicFlags[selectedMember.memberId] ? "공개 중" : "비공개"}
                  </button>
                  <button
                    type="button"
                    disabled={commentSavingMemberId === selectedMember.memberId}
                    onClick={() => handleCommentSave(selectedMember.memberId)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    {commentSavingMemberId === selectedMember.memberId ? "저장 중" : "저장"}
                  </button>
                </div>
              </section>
            )}
          </aside>
        </section>
      </div>
      {drilldown && currentProjectId != null && (
        <MemberDrilldownPanel
          mode={drilldown.mode}
          memberName={mergedReports.find((report) => report.memberId === drilldown.memberId)?.name ?? ""}
          memberTasks={projectTasks.filter((task) => task.assignee === drilldown.memberId)}
          projectId={currentProjectId}
          userId={Number(drilldown.memberId)}
          onClose={() => setDrilldown(null)}
          workloadEvidence={contributionByMemberId[drilldown.memberId]}
          teamMeanCompletion={teamMeanCompletion}
        />
      )}
    </div>
  );
}

// ─── AI assistant panel ───────────────────────────────────────────────────────
